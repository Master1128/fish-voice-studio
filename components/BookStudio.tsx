"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BibleCitationSettings,
  Engine,
  FishModel,
  PronunciationDictionarySettings,
  TtsControls,
  VoiceItem,
} from "@/lib/types";
import type { AppKeys } from "@/lib/client";
import { formatBytes, loadPronunciationDictionary, splitLongText } from "@/lib/client";
import {
  assignBookFolders,
  bookFolderName,
  bookKeyFor,
  chapterFileName,
  clearJobState,
  downloadRoot,
  loadEpubFile,
  loadJobState,
  pickOutputRoot,
  saveJobState,
  supportsDirectoryPicker,
  synthesizeChapter,
  tagChapter,
  type OutputRoot,
  type OutputTarget,
} from "@/lib/bookJob";
import { estimateSeconds, formatDuration, type EpubBook } from "@/lib/epub";
import { MODELS } from "@/lib/constants";
import { prepareTextForTts } from "@/lib/ttsText";
import { createDefaultPronunciationDictionary } from "@/lib/pronunciationDictionary";
import { Badge, Btn, Collapsible, Field, Range, Select, Spinner, Toggle } from "./ui";
import { VoiceAvatar } from "./VoiceCard";
import { VoicePicker } from "./VoicePicker";
import type { KeyAvailability } from "./Studio";

/** Controles fijos pensados para audiolibro: MP3 y continuidad entre fragmentos. */
const BOOK_CONTROLS: TtsControls = {
  outputFormat: "mp3",
  mp3Bitrate: 128,
  opusBitrate: 48000,
  sampleRate: 44100,
  latency: "normal",
  speed: 1,
  volume: 0,
  normalizeLoudness: true,
  useCreativity: false,
  temperature: 0.8,
  topP: 0.7,
  useAdvanced: true,
  chunkLength: 200,
  conditionOnPreviousChunks: true,
  qualityGuard: false,
};

const DEFAULT_BIBLE_CITATIONS: BibleCitationSettings = { enabled: true, style: "compact" };

interface LogEntry {
  id: string;
  kind: "ok" | "warn" | "err";
  text: string;
}

type ItemStatus = "pending" | "running" | "done" | "partial" | "error";

interface QueueItem {
  /** clave de reanudación del libro; también sirve de key de React */
  id: string;
  fileName: string;
  /** subcarpeta de destino, ya desempatada contra el resto de la cola */
  folder: string;
  book: EpubBook;
  status: ItemStatus;
  error?: string;
  chaptersDone: number;
  bytes: number;
}

/** Capítulos que se generan sin preguntar: el cuerpo del libro. */
function bodyChapterIds(book: EpubBook): Set<string> {
  return new Set(book.chapters.filter((c) => !c.likelyFrontMatter).map((c) => c.id));
}

interface Props {
  keys: AppKeys;
  avail: KeyAvailability;
  onOpenSettings: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}

export function BookStudio({ keys, avail, onOpenSettings, toast }: Props) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Solo se usan en modo de un libro, donde se eligen capítulos a mano
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Set<string>>(new Set());

  // Con key del Gateway se prefiere ese motor: mientras la promo sirva, es
  // gratis. Sin ella, Fish directo es el que funciona.
  const [engine, setEngine] = useState<Engine>(avail.gw ? "gateway" : "fish");
  const engineTouched = useRef(false);
  const [model, setModel] = useState<FishModel>("s2.1-pro");
  const [freeSuffix, setFreeSuffix] = useState(true);
  const [voice, setVoice] = useState<VoiceItem | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [bitrate, setBitrate] = useState<64 | 128 | 192>(128);
  const [maxChunk, setMaxChunk] = useState(450);
  const [pauseMs, setPauseMs] = useState(150);
  const [concurrency, setConcurrency] = useState(3);

  const [root, setRoot] = useState<OutputRoot | null>(null);
  const [running, setRunning] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [progress, setProgress] = useState<{
    bookTitle: string;
    bookIndex: number;
    bookCount: number;
    position: number;
    total: number;
    title: string;
    chunkDone: number;
    chunkTotal: number;
  } | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [bytesWritten, setBytesWritten] = useState(0);

  const [pronunciationDictionary, setPronunciationDictionary] =
    useState<PronunciationDictionarySettings>(createDefaultPronunciationDictionary);
  const cancelRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const single = items.length === 1 ? items[0] : null;
  const isQueue = items.length > 1;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPronunciationDictionary(loadPronunciationDictionary());
  }, []);

  // La key del servidor llega por /api/status después del primer render, así
  // que el valor inicial del motor puede quedarse corto.
  useEffect(() => {
    if (avail.gw && !engineTouched.current) setEngine("gateway");
  }, [avail.gw]);

  const addLog = useCallback((kind: LogEntry["kind"], text: string) => {
    setLog((prev) => [{ id: `${Date.now()}-${Math.random()}`, kind, text }, ...prev].slice(0, 400));
  }, []);

  // ---------- carga de libros ----------

  const openFiles = useCallback(
    async (files: File[]) => {
      const epubs = files.filter((f) => /\.epub$/i.test(f.name));
      if (epubs.length === 0) {
        toast("Arrastra archivos .epub", "error");
        return;
      }
      setLoading(true);
      const loaded: QueueItem[] = [];
      const failed: string[] = [];
      try {
        for (const file of epubs) {
          try {
            const book = await loadEpubFile(file);
            loaded.push({
              id: bookKeyFor(file, book),
              fileName: file.name,
              folder: "",
              book,
              status: "pending",
              chaptersDone: 0,
              bytes: 0,
            });
          } catch (err) {
            failed.push(`${file.name}: ${err instanceof Error ? err.message : "no se pudo leer"}`);
          }
        }
        // Un EPUB repetido en la misma tanda se generaría dos veces en la
        // misma carpeta: se conserva solo la primera aparición.
        const unique = loaded.filter(
          (item, i) => loaded.findIndex((o) => o.id === item.id) === i
        );
        const duplicates = loaded.length - unique.length;

        // Dos EPUB con el mismo título y autor compartirían carpeta y se
        // sobreescribirían: aquí se desempatan antes de escribir nada.
        const folders = assignBookFolders(unique);
        const withFolders = unique.map((item, i) => ({ ...item, folder: folders[i] }));
        const collided = withFolders.filter((it, i) => it.folder !== bookFolderName(unique[i].book));

        setItems(withFolders);
        setBytesWritten(0);
        // El registro se limpia antes de anotar nada, o los avisos de esta
        // carga se perderían al vaciarlo.
        setLog([]);
        failed.forEach((f) => addLog("err", f));
        if (duplicates > 0) {
          addLog("warn", `${duplicates} archivo(s) son el mismo libro: se omiten los repetidos.`);
        }
        if (collided.length > 0) {
          addLog(
            "warn",
            `${collided.length} libro(s) comparten título y autor: van a carpetas separadas (${collided
              .map((c) => c.folder)
              .join(", ")}).`
          );
        }

        if (unique.length === 1) {
          const book = unique[0].book;
          const alreadyDone = new Set(loadJobState(unique[0].id)?.done ?? []);
          setDone(alreadyDone);
          // Por defecto solo el cuerpo del libro: el paratexto queda listado
          // pero desmarcado, para no narrar el índice ni los créditos.
          setSelected(
            new Set([...bodyChapterIds(book)].filter((id) => !alreadyDone.has(id)))
          );
          const frontMatter = book.chapters.filter((c) => c.likelyFrontMatter).length;
          if (frontMatter > 0) {
            addLog(
              "warn",
              `${frontMatter} secciones quedan desmarcadas (créditos, colección, índice). Revísalas si crees que alguna es un capítulo.`
            );
          }
          if (alreadyDone.size > 0) {
            addLog("ok", `Se reanuda: ${alreadyDone.size} capítulos ya estaban generados.`);
          }
          toast(`«${book.title}» · ${book.chapters.length} capítulos`, "success");
        } else if (unique.length > 1) {
          setDone(new Set());
          setSelected(new Set());
          toast(`${unique.length} libros en cola`, "success");
        }
      } finally {
        setLoading(false);
      }
    },
    [toast, addLog]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      openFiles([...(e.dataTransfer.files ?? [])]);
    },
    [openFiles]
  );

  // ---------- destino ----------

  const chooseFolder = useCallback(async () => {
    try {
      const picked = await pickOutputRoot();
      setRoot(picked);
      toast(`Se guardará en ${picked.label}`, "success");
    } catch (err) {
      // El usuario cerró el selector: no es un error que merezca aviso
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast(err instanceof Error ? err.message : "No se pudo elegir la carpeta", "error");
    }
  }, [toast]);

  // ---------- estimaciones ----------

  /** Capítulos que se generarían ahora mismo, en cualquiera de los dos modos. */
  const pendingChapters = useMemo(() => {
    if (single) {
      return single.book.chapters
        .filter((c) => selected.has(c.id) && !done.has(c.id))
        .map((c) => ({ book: single.book, chapter: c }));
    }
    return items.flatMap((item) => {
      const wanted = bodyChapterIds(item.book);
      const saved = new Set(loadJobState(item.id)?.done ?? []);
      return item.book.chapters
        .filter((c) => wanted.has(c.id) && !saved.has(c.id))
        .map((c) => ({ book: item.book, chapter: c }));
    });
  }, [single, items, selected, done]);

  /**
   * Se cuenta con el divisor real, no con `chars / maxChunk`: partir por
   * oraciones deja fragmentos a medias y la división aproximada se queda un
   * 15% corta, justo en el número con el que se decide lanzar el trabajo.
   */
  const requests = useMemo(
    () =>
      pendingChapters.reduce(
        (sum, { chapter }) => sum + splitLongText(chapter.text, maxChunk).length,
        0
      ),
    [pendingChapters, maxChunk]
  );

  const stats = useMemo(() => {
    const words = pendingChapters.reduce((sum, { chapter }) => sum + chapter.words, 0);
    return {
      chars: pendingChapters.reduce((sum, { chapter }) => sum + chapter.chars, 0),
      words,
      requests,
      audioSeconds: estimateSeconds(words, speed),
      // ~4 s por petición más la pausa, repartido entre los hilos en vuelo
      jobSeconds: (requests * (4 + pauseMs / 1000)) / Math.max(1, concurrency),
    };
  }, [pendingChapters, requests, speed, pauseMs, concurrency]);

  const toggleChapter = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ---------- generación de un libro ----------

  /**
   * Bucle de capítulos de un solo libro. Lo comparten el modo de un libro y la
   * cola, para que la reanudación y el etiquetado sean idénticos en los dos.
   */
  const runBook = useCallback(
    async (
      item: QueueItem,
      target: OutputTarget,
      wanted: Set<string>,
      bookIndex: number,
      bookCount: number,
      onChapterDone: (completedCount: number, bytes: number) => void
    ): Promise<{ completed: Set<string>; bytes: number }> => {
      const book = item.book;
      const total = book.chapters.length;
      const voiceTitle = voice?.title || "Voz por defecto";
      const controls: TtsControls = { ...BOOK_CONTROLS, mp3Bitrate: bitrate, speed };

      // Reanudación: manda lo que hay en la carpeta sobre el estado guardado
      const completed = new Set(loadJobState(item.id)?.done ?? []);
      const existing = (await target.listExisting?.()) ?? new Set<string>();
      if (existing.size > 0) {
        book.chapters.forEach((c, i) => {
          if (existing.has(chapterFileName(i + 1, total, c.title))) completed.add(c.id);
        });
      }
      const todo = book.chapters.filter((c) => wanted.has(c.id) && !completed.has(c.id));
      if (todo.length < wanted.size) {
        addLog("ok", `«${book.title}»: ${wanted.size - todo.length} capítulos ya estaban hechos.`);
      }

      let bytes = 0;
      for (const chapter of todo) {
        if (cancelRef.current) throw new Error("Generación cancelada");
        const position = book.chapters.findIndex((c) => c.id === chapter.id) + 1;
        setProgress({
          bookTitle: book.title,
          bookIndex,
          bookCount,
          position,
          total,
          title: chapter.title,
          chunkDone: 0,
          chunkTotal: splitLongText(chapter.text, maxChunk).length,
        });

        // El mismo pipeline del Estudio TTS: citas bíblicas y diccionario
        const text = prepareTextForTts(
          chapter.text,
          DEFAULT_BIBLE_CITATIONS,
          pronunciationDictionary
        );

        const { blob, warnings, chunks } = await synthesizeChapter(text, {
          engine,
          model,
          freeSuffix,
          voice: voice?._id,
          controls,
          maxChunk,
          keys,
          pauseMs,
          concurrency,
          signal: {
            get aborted() {
              return cancelRef.current;
            },
          },
          onChunk: (chunkDone, chunkTotal) =>
            setProgress((prev) => (prev ? { ...prev, chunkDone, chunkTotal } : prev)),
        });

        const tagged = tagChapter(blob, book, chapter, position, total, voiceTitle);
        await target.write(chapterFileName(position, total, chapter.title), tagged);

        completed.add(chapter.id);
        bytes += tagged.size;
        saveJobState(item.id, {
          title: book.title,
          done: [...completed],
          updatedAt: Date.now(),
        });
        setBytesWritten((prev) => prev + tagged.size);
        onChapterDone(completed.size, bytes);
        addLog(
          "ok",
          `${position}/${total} · ${chapter.title} · ${chunks} fragmentos · ${formatBytes(tagged.size)}`
        );
        warnings.forEach((w) => addLog("warn", `${chapter.title}: ${w}`));
      }
      return { completed, bytes };
    },
    [
      voice, bitrate, speed, engine, model, freeSuffix, maxChunk, keys, pauseMs,
      concurrency, pronunciationDictionary, addLog,
    ]
  );

  // ---------- generación de la tanda ----------

  const generate = useCallback(async () => {
    if (items.length === 0 || pendingChapters.length === 0) return;
    if (engine === "gateway" && !avail.gw) {
      toast("Configura tu API key del Gateway", "error");
      onOpenSettings();
      return;
    }
    if (engine === "fish" && !avail.fish) {
      toast("El modo Fish directo necesita una key de fish.audio", "error");
      onOpenSettings();
      return;
    }

    const out = root ?? downloadRoot();
    if (!root) {
      addLog("warn", "Sin carpeta elegida: cada capítulo se descargará por separado.");
    }

    setRunning(true);
    setCanceling(false);
    cancelRef.current = false;
    let booksDone = 0;
    let booksFailed = 0;

    const setStatus = (id: string, patch: Partial<QueueItem>) =>
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (cancelRef.current) break;
        const wanted = single ? new Set(selected) : bodyChapterIds(item.book);
        if (wanted.size === 0) continue;

        setStatus(item.id, { status: "running", error: undefined });
        if (items.length > 1) addLog("ok", `▶ ${item.book.title}`);

        try {
          const target = await out.forBook(item.folder);
          const { completed, bytes } = await runBook(
            item,
            target,
            wanted,
            i + 1,
            items.length,
            (count, written) => {
              setStatus(item.id, { chaptersDone: count, bytes: written });
              if (single) setDone(new Set(loadJobState(item.id)?.done ?? []));
            }
          );
          const missing = [...wanted].filter((id) => !completed.has(id)).length;
          setStatus(item.id, {
            status: missing === 0 ? "done" : "partial",
            chaptersDone: completed.size,
            bytes,
          });
          if (single) setDone(completed);
          booksDone += 1;
          if (items.length > 1) {
            addLog("ok", `✔ ${item.book.title} · ${formatBytes(bytes)}`);
          }
        } catch (err) {
          if (cancelRef.current) {
            setStatus(item.id, { status: "partial" });
            break;
          }
          const message = err instanceof Error ? err.message : "Error desconocido";
          setStatus(item.id, { status: "error", error: message });
          addLog("err", `✖ ${item.book.title}: ${message}`);
          booksFailed += 1;
          // Se sigue con el siguiente libro: un EPUB raro no debe tumbar la
          // tanda entera. Lo que quedó escrito sigue en disco y es reanudable.
          if (single) throw err;
        }
      }

      if (cancelRef.current) {
        toast(`Detenido. Lo generado sigue en disco.`, "info");
      } else if (booksFailed > 0) {
        toast(
          `${booksDone} libro(s) listos, ${booksFailed} con errores. Mira el registro.`,
          booksDone > 0 ? "info" : "error"
        );
      } else if (items.length > 1) {
        toast(`Cola terminada: ${booksDone} libros`, "success");
      } else {
        toast("Audiolibro completo", "success");
      }
    } catch (err) {
      toast(
        `${err instanceof Error ? err.message : "Error"}. Lo generado sigue en disco; pulsa Continuar para reanudar.`,
        "error"
      );
    } finally {
      setRunning(false);
      setCanceling(false);
      setProgress(null);
    }
  }, [
    items, pendingChapters, engine, avail, root, single, selected, runBook, toast,
    onOpenSettings, addLog,
  ]);

  const cancel = () => {
    cancelRef.current = true;
    setCanceling(true);
  };

  const resetProgress = () => {
    items.forEach((item) => clearJobState(item.id));
    setItems((prev) =>
      prev.map((it) => ({ ...it, status: "pending", error: undefined, chaptersDone: 0, bytes: 0 }))
    );
    if (single) {
      setDone(new Set());
      setSelected(bodyChapterIds(single.book));
    }
    setBytesWritten(0);
    addLog("warn", "Progreso reiniciado: se volverá a generar todo.");
  };

  const modelInfo = MODELS.find((m) => m.id === model);

  // ---------- render: sin libros ----------

  if (items.length === 0) {
    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-20 text-center transition-colors ${
          dragging ? "border-cyan-500 bg-cyan-500/5" : "border-zinc-800 bg-zinc-900/30"
        }`}
      >
        <div className="text-5xl">📚</div>
        <h2 className="text-lg font-semibold text-zinc-100">Convierte EPUB en audiolibros</h2>
        <p className="max-w-md text-sm text-zinc-400">
          Arrastra uno o <strong className="text-zinc-200">varios</strong> libros. Se leen enteros
          en tu navegador —no se suben a ningún servidor— y sale un MP3 por capítulo, etiquetado y
          numerado. Con varios, se encadenan solos sin que estés delante.
        </p>
        <Btn variant="primary" onClick={() => fileRef.current?.click()} disabled={loading}>
          {loading ? <Spinner /> : "📂"} Elegir archivos .epub
        </Btn>
        <input
          ref={fileRef}
          type="file"
          accept=".epub,application/epub+zip"
          multiple
          className="hidden"
          onChange={(e) => {
            openFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <p className="text-[11px] text-zinc-600">Los EPUB con DRM de tienda no se pueden abrir.</p>
      </div>
    );
  }

  const totalPending = pendingChapters.length;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      {/* ---------- columna izquierda ---------- */}
      <div className="space-y-4">
        {/* cabecera */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              {single ? (
                <>
                  <h2 className="truncate text-base font-semibold text-zinc-100">
                    {single.book.title}
                  </h2>
                  <p className="mt-0.5 text-sm text-zinc-400">
                    {single.book.author || "Autor desconocido"} · {single.book.chapters.length}{" "}
                    capítulos
                    {single.book.skipped > 0 && ` · ${single.book.skipped} sin texto`}
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-base font-semibold text-zinc-100">
                    Cola de {items.length} libros
                  </h2>
                  <p className="mt-0.5 text-sm text-zinc-400">
                    {totalPending} capítulos por generar ·{" "}
                    {formatDuration(stats.audioSeconds)} de audio
                  </p>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              {bytesWritten > 0 && <Badge tone="cyan">{formatBytes(bytesWritten)}</Badge>}
              <Btn size="sm" onClick={() => setItems([])} disabled={running}>
                {isQueue ? "Otra cola" : "Otro libro"}
              </Btn>
            </div>
          </div>
        </div>

        {/* progreso */}
        {running && progress && (
          <div className="rounded-2xl border border-cyan-900/50 bg-cyan-950/20 p-4">
            {progress.bookCount > 1 && (
              <p className="mb-2 truncate text-xs text-cyan-400">
                Libro {progress.bookIndex}/{progress.bookCount} · {progress.bookTitle}
              </p>
            )}
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-cyan-200">
                <Spinner className="mr-2 inline-block" />
                {progress.position}/{progress.total} · {progress.title}
              </span>
              <span className="shrink-0 font-mono text-xs text-cyan-400">
                {progress.chunkDone}/{progress.chunkTotal}
              </span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-teal-400 transition-all"
                style={{
                  width: `${(progress.chunkDone / Math.max(1, progress.chunkTotal)) * 100}%`,
                }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[11px] text-zinc-500">{formatBytes(bytesWritten)} escritos</span>
              <Btn size="sm" variant="danger" onClick={cancel} disabled={canceling}>
                {canceling ? "Deteniendo…" : "Detener"}
              </Btn>
            </div>
          </div>
        )}

        {/* lista de libros (cola) */}
        {isQueue && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40">
            <div className="border-b border-zinc-800 px-4 py-3 text-xs font-medium uppercase tracking-wide text-zinc-400">
              Libros · se generan en orden
            </div>
            <ul className="divide-y divide-zinc-800/70">
              {items.map((item, i) => {
                const body = bodyChapterIds(item.book).size;
                const words = item.book.chapters
                  .filter((c) => !c.likelyFrontMatter)
                  .reduce((s, c) => s + c.words, 0);
                return (
                  <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="w-5 shrink-0 text-right font-mono text-[11px] text-zinc-600">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-zinc-200">
                        {item.book.title}
                      </span>
                      <span className="block truncate text-[11px] text-zinc-500">
                        {item.book.author || "Autor desconocido"} · {body} capítulos ·{" "}
                        {formatDuration(estimateSeconds(words, speed))}
                        {item.error && (
                          <span className="text-red-400"> · {item.error.slice(0, 80)}</span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0">
                      {item.status === "running" && <Spinner />}
                      {item.status === "done" && (
                        <Badge tone="green">
                          ✓ {item.bytes > 0 ? formatBytes(item.bytes) : "listo"}
                        </Badge>
                      )}
                      {item.status === "partial" && <Badge tone="amber">a medias</Badge>}
                      {item.status === "error" && <Badge tone="red">error</Badge>}
                      {item.status === "pending" && (
                        <span className="text-[11px] text-zinc-600">en espera</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* lista de capítulos (un libro) */}
        {single && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40">
            <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                Capítulos · {totalPending} por generar
              </span>
              <div className="flex gap-1">
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={running}
                  onClick={() => setSelected(bodyChapterIds(single.book))}
                >
                  Solo el libro
                </Btn>
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={running}
                  onClick={() => setSelected(new Set(single.book.chapters.map((c) => c.id)))}
                >
                  Todos
                </Btn>
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={running}
                  onClick={() => setSelected(new Set())}
                >
                  Ninguno
                </Btn>
              </div>
            </div>
            <ul className="max-h-[420px] divide-y divide-zinc-800/70 overflow-y-auto">
              {single.book.chapters.map((chapter, i) => {
                const isDone = done.has(chapter.id);
                return (
                  <li key={chapter.id}>
                    <label
                      className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-zinc-800/40 ${
                        isDone ? "opacity-55" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(chapter.id)}
                        disabled={running}
                        onChange={() => toggleChapter(chapter.id)}
                        className="h-4 w-4 shrink-0 cursor-pointer accent-cyan-500"
                      />
                      <span className="w-8 shrink-0 text-right font-mono text-[11px] text-zinc-600">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                        {chapter.title}
                      </span>
                      {chapter.likelyFrontMatter && (
                        <span
                          className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400"
                          title="No aparece en el índice del libro: suele ser créditos, portadilla o el propio índice"
                        >
                          paratexto
                        </span>
                      )}
                      <span className="shrink-0 font-mono text-[11px] text-zinc-500">
                        {formatDuration(estimateSeconds(chapter.words, speed))}
                      </span>
                      {isDone && <span className="shrink-0 text-xs text-emerald-400">✓</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* registro */}
        {log.length > 0 && (
          <Collapsible title={`Registro (${log.length})`}>
            <ul className="max-h-64 space-y-1 overflow-y-auto font-mono text-[11px]">
              {log.map((entry) => (
                <li
                  key={entry.id}
                  className={
                    entry.kind === "err"
                      ? "text-red-400"
                      : entry.kind === "warn"
                        ? "text-amber-400"
                        : "text-zinc-400"
                  }
                >
                  {entry.text}
                </li>
              ))}
            </ul>
          </Collapsible>
        )}
      </div>

      {/* ---------- columna derecha ---------- */}
      <div className="space-y-4">
        <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <Field label="Voz del narrador">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={running}
              className="flex w-full items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-left transition-colors hover:border-zinc-500 disabled:opacity-40"
            >
              {voice ? (
                <>
                  <VoiceAvatar title={voice.title} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">
                    {voice.title}
                  </span>
                </>
              ) : (
                <span className="text-sm text-zinc-500">Elegir voz…</span>
              )}
            </button>
          </Field>

          <Field
            label="Motor"
            hint={
              engine === "fish"
                ? "API oficial de fish.audio. Independiente de la promo de Vercel."
                : "Gratis mientras la promo siga sirviendo."
            }
          >
            <Select
              value={engine}
              disabled={running}
              onChange={(e) => {
                engineTouched.current = true;
                setEngine(e.target.value as Engine);
              }}
              options={[
                { value: "gateway", label: "Vercel AI Gateway (gratis)" },
                { value: "fish", label: "Fish directo (key de fish.audio)" },
              ]}
            />
          </Field>

          <Field label="Modelo" hint={modelInfo?.languages}>
            <Select
              value={model}
              disabled={running}
              onChange={(e) => setModel(e.target.value as FishModel)}
              options={MODELS.map((m) => ({ value: m.id, label: m.name }))}
            />
          </Field>

          <Toggle
            checked={freeSuffix}
            onChange={setFreeSuffix}
            label="Sufijo -free"
            hint={
              engine === "fish" && model !== "s2.1-pro"
                ? "Ojo: en modo Fish solo s2.1-pro tiene variante gratuita"
                : "Si no hay cuota gratis, falla en vez de cobrar"
            }
          />

          <Range
            label="Velocidad"
            min={0.7}
            max={1.4}
            step={0.05}
            value={speed}
            display={`${speed.toFixed(2)}×`}
            disabled={running}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />

          <Field label="Calidad MP3">
            <Select
              value={String(bitrate)}
              disabled={running}
              onChange={(e) => setBitrate(Number(e.target.value) as 64 | 128 | 192)}
              options={[
                { value: "64", label: "64 kbps · voz, archivo mínimo" },
                { value: "128", label: "128 kbps · recomendado" },
                { value: "192", label: "192 kbps · máxima" },
              ]}
            />
          </Field>

          <Collapsible title="Ajustes avanzados">
            <div className="space-y-4">
              <Range
                label="Fragmentos en paralelo"
                min={1}
                max={6}
                step={1}
                value={concurrency}
                display={concurrency === 1 ? "1 (secuencial)" : `${concurrency} a la vez`}
                disabled={running}
                onChange={(e) => setConcurrency(Number(e.target.value))}
              />
              <Range
                label="Pausa entre peticiones"
                min={0}
                max={2000}
                step={50}
                value={pauseMs}
                display={`${pauseMs} ms`}
                disabled={running}
                onChange={(e) => setPauseMs(Number(e.target.value))}
              />
              <Range
                label="Tamaño de fragmento"
                min={200}
                max={800}
                step={50}
                value={maxChunk}
                display={`${maxChunk} caracteres`}
                disabled={running}
                onChange={(e) => setMaxChunk(Number(e.target.value))}
              />
              <p className="text-[11px] leading-snug text-zinc-500">
                Paralelizar es lo que más acorta el trabajo: 3 a la vez baja un libro de ~45 a ~15
                minutos, y el audio se une siempre en orden. Si la API empieza a cortar por límite
                de tasa, baja los fragmentos en paralelo o sube la pausa. Cada fragmento se
                reintenta hasta 4 veces con espera creciente.
              </p>
              <Btn size="sm" variant="danger" onClick={resetProgress} disabled={running}>
                Reiniciar progreso
              </Btn>
            </div>
          </Collapsible>
        </div>

        {/* destino */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <Field
            label="Destino"
            hint={
              root
                ? "Una subcarpeta por libro. Cada capítulo se escribe en cuanto termina."
                : supportsDirectoryPicker()
                  ? "Elígela una vez y sirve para toda la cola."
                  : "Este navegador no permite elegir carpeta: se descargará capítulo a capítulo."
            }
          >
            {supportsDirectoryPicker() ? (
              <Btn onClick={chooseFolder} disabled={running} className="w-full">
                📁 {root ? root.label : "Elegir carpeta…"}
              </Btn>
            ) : (
              <div className="rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-400">
                Carpeta de descargas
              </div>
            )}
          </Field>
        </div>

        {/* estimación y acción */}
        <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <dl className="space-y-1.5 text-xs">
            {isQueue && (
              <div className="flex justify-between">
                <dt className="text-zinc-500">Libros</dt>
                <dd className="font-mono text-zinc-300">{items.length}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-zinc-500">Por generar</dt>
              <dd className="font-mono text-zinc-300">{totalPending} capítulos</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Caracteres</dt>
              <dd className="font-mono text-zinc-300">{stats.chars.toLocaleString("es")}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Peticiones a la API</dt>
              <dd className="font-mono text-zinc-300">{stats.requests.toLocaleString("es")}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Audio estimado</dt>
              <dd className="font-mono text-cyan-300">{formatDuration(stats.audioSeconds)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Tardará unos</dt>
              <dd className="font-mono text-amber-300">{formatDuration(stats.jobSeconds)}</dd>
            </div>
          </dl>

          {running ? (
            <Btn variant="danger" onClick={cancel} disabled={canceling} className="w-full">
              {canceling ? "Deteniendo…" : "Detener"}
            </Btn>
          ) : (
            <Btn
              variant="primary"
              size="lg"
              onClick={generate}
              disabled={totalPending === 0}
              className="w-full"
            >
              {totalPending === 0
                ? "✓ Todo generado"
                : bytesWritten > 0
                  ? `Continuar (${totalPending})`
                  : isQueue
                    ? `🎧 Generar ${items.length} audiolibros`
                    : "🎧 Generar audiolibro"}
            </Btn>
          )}

          <p className="text-[11px] leading-snug text-zinc-500">
            No cierres esta pestaña mientras genera. Si se interrumpe, lo escrito se conserva y el
            botón pasa a «Continuar».
            {isQueue && " Si un libro falla, se sigue con el siguiente."}
          </p>
        </div>
      </div>

      <VoicePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        keys={keys}
        title="Elegir voz del narrador"
        onSelect={(v) => {
          setVoice(v);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
