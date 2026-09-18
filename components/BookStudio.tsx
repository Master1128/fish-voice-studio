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
  bookKeyFor,
  chapterFileName,
  clearJobState,
  downloadTarget,
  loadEpubFile,
  loadJobState,
  pickDirectoryTarget,
  saveJobState,
  supportsDirectoryPicker,
  synthesizeChapter,
  tagChapter,
  type OutputTarget,
} from "@/lib/bookJob";
import { estimateSeconds, formatDuration, safeFileName, type EpubBook } from "@/lib/epub";
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

interface Props {
  keys: AppKeys;
  avail: KeyAvailability;
  onOpenSettings: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}

export function BookStudio({ keys, avail, onOpenSettings, toast }: Props) {
  const [book, setBook] = useState<EpubBook | null>(null);
  const [bookKey, setBookKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);

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

  const [target, setTarget] = useState<OutputTarget | null>(null);
  const [running, setRunning] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [chapterProgress, setChapterProgress] = useState<{
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
    setLog((prev) => [{ id: `${Date.now()}-${Math.random()}`, kind, text }, ...prev].slice(0, 200));
  }, []);

  // ---------- carga del libro ----------

  const openBook = useCallback(
    async (file: File) => {
      if (!/\.epub$/i.test(file.name)) {
        toast("Ese archivo no es un .epub", "error");
        return;
      }
      setLoading(true);
      try {
        const parsed = await loadEpubFile(file);
        const key = bookKeyFor(file, parsed);
        const saved = loadJobState(key);
        const alreadyDone = new Set(saved?.done ?? []);
        setBook(parsed);
        setBookKey(key);
        setDone(alreadyDone);
        // Por defecto solo el cuerpo del libro: el paratexto queda listado
        // pero desmarcado, para no narrar el índice ni los créditos.
        setSelected(
          new Set(
            parsed.chapters
              .filter((c) => !alreadyDone.has(c.id) && !c.likelyFrontMatter)
              .map((c) => c.id)
          )
        );
        setTarget(null);
        setLog([]);
        setBytesWritten(0);
        const extra = parsed.skipped
          ? ` · ${parsed.skipped} sección${parsed.skipped === 1 ? "" : "es"} sin texto omitida${parsed.skipped === 1 ? "" : "s"}`
          : "";
        toast(`«${parsed.title}» · ${parsed.chapters.length} capítulos${extra}`, "success");
        const frontMatter = parsed.chapters.filter((c) => c.likelyFrontMatter).length;
        if (frontMatter > 0) {
          addLog(
            "warn",
            `${frontMatter} secciones no están en el índice del libro (créditos, colección, índice): quedan desmarcadas. Revísalas si crees que alguna es un capítulo.`
          );
        }
        if (alreadyDone.size > 0) {
          addLog("ok", `Se reanuda: ${alreadyDone.size} capítulos ya estaban generados.`);
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : "No se pudo leer el EPUB", "error");
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
      const file = e.dataTransfer.files?.[0];
      if (file) openBook(file);
    },
    [openBook]
  );

  // ---------- destino ----------

  const chooseFolder = useCallback(async () => {
    if (!book) return;
    try {
      const picked = await pickDirectoryTarget(
        book.author ? `${safeFileName(book.author, 40)} - ${book.title}` : book.title
      );
      setTarget(picked);
      const existing = (await picked.listExisting?.()) ?? new Set<string>();
      if (existing.size > 0) {
        // La carpeta manda sobre el estado guardado: si el archivo está, está hecho
        const total = book.chapters.length;
        const already = new Set<string>();
        book.chapters.forEach((chapter, i) => {
          if (existing.has(chapterFileName(i + 1, total, chapter.title))) already.add(chapter.id);
        });
        if (already.size > 0) {
          setDone(already);
          setSelected(
            new Set(
              book.chapters
                .filter((c) => !already.has(c.id) && !c.likelyFrontMatter)
                .map((c) => c.id)
            )
          );
          saveJobState(bookKey, { title: book.title, done: [...already], updatedAt: Date.now() });
          addLog("ok", `La carpeta ya tiene ${already.size} capítulos: se saltarán.`);
        }
      }
      toast(`Se guardará en ${picked.label}`, "success");
    } catch (err) {
      // El usuario cerró el selector: no es un error que merezca aviso
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast(err instanceof Error ? err.message : "No se pudo elegir la carpeta", "error");
    }
  }, [book, bookKey, toast, addLog]);

  // ---------- selección ----------

  const pending = useMemo(
    () => (book ? book.chapters.filter((c) => selected.has(c.id) && !done.has(c.id)) : []),
    [book, selected, done]
  );

  /**
   * Se cuenta con el divisor real, no con `chars / maxChunk`: partir por
   * oraciones deja fragmentos a medias y la división aproximada se queda un
   * 15% corta, justo en el número con el que se decide lanzar el trabajo.
   */
  const requests = useMemo(
    () => pending.reduce((sum, c) => sum + splitLongText(c.text, maxChunk).length, 0),
    [pending, maxChunk]
  );

  const stats = useMemo(() => {
    const words = pending.reduce((sum, c) => sum + c.words, 0);
    return {
      chars: pending.reduce((sum, c) => sum + c.chars, 0),
      words,
      requests,
      audioSeconds: estimateSeconds(words, speed),
      // ~4 s por petición más la pausa, repartido entre los hilos en vuelo
      jobSeconds: (requests * (4 + pauseMs / 1000)) / Math.max(1, concurrency),
    };
  }, [pending, requests, speed, pauseMs, concurrency]);

  const toggleChapter = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ---------- generación ----------

  const generate = useCallback(async () => {
    if (!book || pending.length === 0) return;
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

    const out = target ?? downloadTarget();
    if (!target) {
      addLog("warn", "Sin carpeta elegida: cada capítulo se descargará por separado.");
    }

    setRunning(true);
    setCanceling(false);
    cancelRef.current = false;
    const total = book.chapters.length;
    const voiceTitle = voice?.title || "Voz por defecto";
    const controls: TtsControls = { ...BOOK_CONTROLS, mp3Bitrate: bitrate, speed };
    const completed = new Set(done);
    let written = 0;

    try {
      for (const chapter of pending) {
        if (cancelRef.current) break;
        const position = book.chapters.findIndex((c) => c.id === chapter.id) + 1;
        setChapterProgress({
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

        try {
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
            signal: { get aborted() { return cancelRef.current; } },
            onChunk: (chunkDone, chunkTotal) =>
              setChapterProgress((prev) => (prev ? { ...prev, chunkDone, chunkTotal } : prev)),
          });

          const tagged = tagChapter(blob, book, chapter, position, total, voiceTitle);
          await out.write(chapterFileName(position, total, chapter.title), tagged);

          completed.add(chapter.id);
          written += tagged.size;
          setDone(new Set(completed));
          setBytesWritten((prev) => prev + tagged.size);
          saveJobState(bookKey, {
            title: book.title,
            done: [...completed],
            updatedAt: Date.now(),
          });
          addLog(
            "ok",
            `${position}/${total} · ${chapter.title} · ${chunks} fragmentos · ${formatBytes(tagged.size)}`
          );
          warnings.forEach((w) => addLog("warn", `${chapter.title}: ${w}`));
        } catch (err) {
          const message = err instanceof Error ? err.message : "Error desconocido";
          if (cancelRef.current) break;
          addLog("err", `${position}/${total} · ${chapter.title}: ${message}`);
          // Se detiene el libro: si falla la key o la cuota, seguir solo
          // encadenaría el mismo error en todos los capítulos restantes.
          throw err;
        }
      }

      const remaining = book.chapters.filter((c) => !completed.has(c.id)).length;
      if (cancelRef.current) {
        toast(`Detenido. ${completed.size}/${total} capítulos listos en disco.`, "info");
      } else if (remaining === 0) {
        toast(`Audiolibro completo: ${total} capítulos, ${formatBytes(written)}`, "success");
      } else {
        toast(`${completed.size}/${total} capítulos listos.`, "success");
      }
    } catch (err) {
      toast(
        `Se detuvo en el capítulo ${completed.size + 1}: ${err instanceof Error ? err.message : "error"}. Lo generado sigue en disco; pulsa Continuar para reanudar.`,
        "error"
      );
    } finally {
      setRunning(false);
      setCanceling(false);
      setChapterProgress(null);
    }
  }, [
    book, pending, engine, avail, target, voice, bitrate, speed, done, model, freeSuffix,
    maxChunk, keys, pauseMs, concurrency, bookKey, pronunciationDictionary, toast,
    onOpenSettings, addLog,
  ]);

  const cancel = () => {
    cancelRef.current = true;
    setCanceling(true);
  };

  const resetProgress = () => {
    if (!book) return;
    clearJobState(bookKey);
    setDone(new Set());
    setSelected(new Set(book.chapters.map((c) => c.id)));
    setBytesWritten(0);
    addLog("warn", "Progreso reiniciado: se volverán a generar todos los capítulos.");
  };

  const modelInfo = MODELS.find((m) => m.id === model);

  // ---------- render ----------

  if (!book) {
    return (
      <div className="space-y-4">
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
          <h2 className="text-lg font-semibold text-zinc-100">Convierte un EPUB en audiolibro</h2>
          <p className="max-w-md text-sm text-zinc-400">
            Arrastra aquí tu libro o elígelo. Se lee entero en tu navegador —no se sube a ningún
            servidor— y se genera un MP3 por capítulo, etiquetado y numerado.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Btn variant="primary" onClick={() => fileRef.current?.click()} disabled={loading}>
              {loading ? <Spinner /> : "📂"} Elegir archivo .epub
            </Btn>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".epub,application/epub+zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) openBook(file);
              e.target.value = "";
            }}
          />
          <p className="text-[11px] text-zinc-600">
            Los EPUB con DRM de tienda no se pueden abrir.
          </p>
        </div>
      </div>
    );
  }

  const allDone = done.size >= book.chapters.length;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      {/* columna izquierda: libro y capítulos */}
      <div className="space-y-4">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-zinc-100">{book.title}</h2>
              <p className="mt-0.5 text-sm text-zinc-400">
                {book.author || "Autor desconocido"} · {book.chapters.length} capítulos
                {book.skipped > 0 && ` · ${book.skipped} sin texto`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {done.size > 0 && (
                <Badge tone={allDone ? "green" : "cyan"}>
                  {done.size}/{book.chapters.length} hechos
                </Badge>
              )}
              <Btn size="sm" onClick={() => setBook(null)} disabled={running}>
                Otro libro
              </Btn>
            </div>
          </div>
        </div>

        {/* progreso en curso */}
        {running && chapterProgress && (
          <div className="rounded-2xl border border-cyan-900/50 bg-cyan-950/20 p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-cyan-200">
                <Spinner className="mr-2 inline-block" />
                {chapterProgress.position}/{chapterProgress.total} · {chapterProgress.title}
              </span>
              <span className="shrink-0 font-mono text-xs text-cyan-400">
                {chapterProgress.chunkDone}/{chapterProgress.chunkTotal}
              </span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-teal-400 transition-all"
                style={{
                  width: `${(chapterProgress.chunkDone / Math.max(1, chapterProgress.chunkTotal)) * 100}%`,
                }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[11px] text-zinc-500">
                {done.size} escritos · {formatBytes(bytesWritten)}
              </span>
              <Btn size="sm" variant="danger" onClick={cancel} disabled={canceling}>
                {canceling ? "Deteniendo…" : "Detener"}
              </Btn>
            </div>
          </div>
        )}

        {/* lista de capítulos */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40">
          <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              Capítulos · {pending.length} por generar
            </span>
            <div className="flex gap-1">
              <Btn
                size="sm"
                variant="ghost"
                disabled={running}
                onClick={() =>
                  setSelected(
                    new Set(
                      book.chapters.filter((c) => !c.likelyFrontMatter).map((c) => c.id)
                    )
                  )
                }
              >
                Solo el libro
              </Btn>
              <Btn
                size="sm"
                variant="ghost"
                disabled={running}
                onClick={() => setSelected(new Set(book.chapters.map((c) => c.id)))}
              >
                Todos
              </Btn>
              <Btn size="sm" variant="ghost" disabled={running} onClick={() => setSelected(new Set())}>
                Ninguno
              </Btn>
            </div>
          </div>
          <ul className="max-h-[420px] divide-y divide-zinc-800/70 overflow-y-auto">
            {book.chapters.map((chapter, i) => {
              const isDone = done.has(chapter.id);
              const isSelected = selected.has(chapter.id);
              return (
                <li key={chapter.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-zinc-800/40 ${
                      isDone ? "opacity-55" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
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

      {/* columna derecha: ajustes */}
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
                label="Tamaño de fragmento"
                min={200}
                max={800}
                step={50}
                value={maxChunk}
                display={`${maxChunk} caracteres`}
                disabled={running}
                onChange={(e) => setMaxChunk(Number(e.target.value))}
              />
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
              <p className="text-[11px] leading-snug text-zinc-500">
                Paralelizar es lo que más acorta el trabajo: 3 a la vez baja un libro de ~45 a
                ~15 minutos, y el audio se une siempre en orden. Si la API empieza a cortar por
                límite de tasa, baja los fragmentos en paralelo o sube la pausa. Cada fragmento se
                reintenta hasta 4 veces con espera creciente.
              </p>
              {done.size > 0 && (
                <Btn size="sm" variant="danger" onClick={resetProgress} disabled={running}>
                  Reiniciar progreso
                </Btn>
              )}
            </div>
          </Collapsible>
        </div>

        {/* destino */}
        <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <Field
            label="Destino"
            hint={
              target
                ? "Cada capítulo se escribe en cuanto termina."
                : supportsDirectoryPicker()
                  ? "Sin carpeta, cada capítulo se descarga por separado."
                  : "Este navegador no permite elegir carpeta: se descargará capítulo a capítulo."
            }
          >
            {supportsDirectoryPicker() ? (
              <Btn onClick={chooseFolder} disabled={running} className="w-full">
                📁 {target ? target.label : "Elegir carpeta…"}
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
            <div className="flex justify-between">
              <dt className="text-zinc-500">Por generar</dt>
              <dd className="font-mono text-zinc-300">{pending.length} capítulos</dd>
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
              disabled={pending.length === 0}
              className="w-full"
            >
              {allDone
                ? "✓ Libro completo"
                : done.size > 0
                  ? `Continuar (${pending.length})`
                  : "🎧 Generar audiolibro"}
            </Btn>
          )}

          <p className="text-[11px] leading-snug text-zinc-500">
            No cierres esta pestaña mientras genera. Si se interrumpe, lo escrito se conserva y el
            botón pasa a «Continuar».
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
