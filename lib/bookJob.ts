"use client";

import { unzipSync } from "fflate";
import type { AppKeys } from "./client";
import { generateChunk, mergeAudioBlobs, splitLongText } from "./client";
import { parseEpub, safeFileName, type EpubBook, type EpubChapter } from "./epub";
import { tagMp3 } from "./id3";
import type { Engine, FishModel, TtsControls } from "./types";

// ---------- carga del EPUB ----------

/**
 * Descomprime y parsea el EPUB **en el navegador**. Subirlo al servidor no es
 * opción: Vercel corta las peticiones en ~4,5 MB y un EPUB ronda los 1-10 MB.
 */
export async function loadEpubFile(file: File): Promise<EpubBook> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes);
  } catch {
    throw new Error("No se pudo abrir el archivo: ¿seguro que es un .epub sin DRM?");
  }
  const entries = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(unzipped)) {
    // fflate conserva las rutas tal cual; se normaliza el separador
    entries.set(path.replace(/\\/g, "/"), data);
  }
  return parseEpub(entries);
}

/** Clave estable para reanudar el mismo libro entre sesiones. */
export function bookKeyFor(file: File, book: EpubBook): string {
  const raw = `${file.name}|${file.size}|${book.title}|${book.chapters.length}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${safeFileName(book.title, 32)}-${hash.toString(36)}`;
}

// ---------- estado de reanudación ----------

const LS_JOBS = "fvs.bookJobs.v1";

export interface BookJobState {
  title: string;
  /** ids de capítulo ya escritos a disco */
  done: string[];
  updatedAt: number;
}

type JobStore = Record<string, BookJobState>;

function readStore(): JobStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_JOBS);
    return raw ? (JSON.parse(raw) as JobStore) : {};
  } catch {
    return {};
  }
}

export function loadJobState(bookKey: string): BookJobState | null {
  return readStore()[bookKey] ?? null;
}

export function saveJobState(bookKey: string, state: BookJobState) {
  const store = readStore();
  store[bookKey] = state;
  // se conservan los 20 libros más recientes
  const trimmed = Object.entries(store)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, 20);
  try {
    localStorage.setItem(LS_JOBS, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    // cuota llena: la reanudación se pierde pero la generación sigue
  }
}

export function clearJobState(bookKey: string) {
  const store = readStore();
  delete store[bookKey];
  try {
    localStorage.setItem(LS_JOBS, JSON.stringify(store));
  } catch {}
}

// ---------- destino de escritura ----------

interface FileSystemWritable {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
}
interface FileSystemFileHandleLike {
  createWritable: () => Promise<FileSystemWritable>;
}
interface FileSystemDirectoryHandleLike {
  name: string;
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<FileSystemFileHandleLike>;
  getDirectoryHandle: (
    name: string,
    opts?: { create?: boolean }
  ) => Promise<FileSystemDirectoryHandleLike>;
  values: () => AsyncIterableIterator<{ kind: string; name: string }>;
}
interface PickerWindow {
  showDirectoryPicker?: (opts?: {
    mode?: "read" | "readwrite";
    id?: string;
  }) => Promise<FileSystemDirectoryHandleLike>;
}

/** Dónde se escriben los capítulos de UN libro. */
export interface OutputTarget {
  kind: "directory" | "download";
  label: string;
  write: (fileName: string, blob: Blob) => Promise<void>;
  /** Archivos ya presentes en el destino; permite reanudar sin `localStorage`. */
  listExisting?: () => Promise<Set<string>>;
}

/**
 * Carpeta raíz elegida UNA vez, que reparte una subcarpeta por libro. Es lo que
 * permite dejar una cola de libros sola: el selector de carpeta exige un gesto
 * del usuario, así que no se puede pedir una por libro a mitad de la tanda.
 */
export interface OutputRoot {
  kind: "directory" | "download";
  label: string;
  forBook: (folderName: string) => Promise<OutputTarget>;
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as PickerWindow).showDirectoryPicker;
}

function directoryTarget(
  dir: FileSystemDirectoryHandleLike,
  label: string
): OutputTarget {
  return {
    kind: "directory",
    label,
    write: async (fileName, blob) => {
      const handle = await dir.getFileHandle(fileName, { create: true });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    },
    listExisting: async () => {
      const names = new Set<string>();
      try {
        for await (const entry of dir.values()) {
          if (entry.kind === "file") names.add(entry.name);
        }
      } catch {
        // si el navegador no expone values(), se usa solo el estado guardado
      }
      return names;
    },
  };
}

/**
 * Pide la carpeta raíz. Cada capítulo se escribe a disco en cuanto termina,
 * así que un libro de 9 horas no tiene que caber en memoria.
 */
export async function pickOutputRoot(): Promise<OutputRoot> {
  const picker = (window as unknown as PickerWindow).showDirectoryPicker;
  if (!picker) throw new Error("Este navegador no permite elegir carpeta");
  const root = await picker({ mode: "readwrite", id: "fvs-audiolibros" });
  return {
    kind: "directory",
    label: root.name,
    forBook: async (folderName) => {
      const safe = safeFileName(folderName);
      const dir = await root.getDirectoryHandle(safe, { create: true });
      return directoryTarget(dir, `${root.name}/${safe}`);
    },
  };
}

/** Alternativa para navegadores sin File System Access: una descarga por capítulo. */
export function downloadRoot(): OutputRoot {
  const target: OutputTarget = {
    kind: "download",
    label: "Carpeta de descargas",
    write: async (fileName, blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // margen para que el navegador inicie la descarga antes de liberar
      await new Promise((resolve) => setTimeout(resolve, 400));
      URL.revokeObjectURL(url);
    },
  };
  return {
    kind: "download",
    label: target.label,
    forBook: async () => target,
  };
}

/** Nombre de la subcarpeta de un libro: «Autor - Título». */
export function bookFolderName(book: { title: string; author: string }): string {
  return book.author
    ? safeFileName(`${safeFileName(book.author, 40)} - ${book.title}`)
    : safeFileName(book.title);
}

/**
 * Asigna una subcarpeta distinta a cada libro de la cola.
 *
 * Hace falta porque dos EPUB distintos pueden traer el mismo título y autor en
 * sus metadatos —una traducción y su original, o dos versiones del mismo
 * trabajo— y compartirían carpeta, sobreescribiéndose capítulo a capítulo sin
 * avisar. Cuando eso pasa, se desempata con el nombre del archivo.
 */
export function assignBookFolders(
  books: { book: { title: string; author: string }; fileName: string }[]
): string[] {
  const used = new Set<string>();
  return books.map(({ book, fileName }) => {
    const base = bookFolderName(book);
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    const stem = safeFileName(fileName.replace(/\.epub$/i, ""), 60);
    let candidate = `${base} (${stem})`;
    let n = 2;
    while (used.has(candidate)) {
      candidate = `${base} (${n})`;
      n += 1;
    }
    used.add(candidate);
    return candidate;
  });
}

// ---------- nombres de archivo ----------

/** `03 - Título del capítulo.mp3`, con ceros suficientes para que ordene bien. */
export function chapterFileName(position: number, total: number, title: string): string {
  const width = Math.max(2, String(total).length);
  return `${String(position).padStart(width, "0")} - ${safeFileName(title, 70)}.mp3`;
}

// ---------- síntesis de un capítulo ----------

export interface ChapterJobOptions {
  engine: Engine;
  model: FishModel;
  freeSuffix: boolean;
  voice?: string;
  controls: TtsControls;
  maxChunk: number;
  keys: AppKeys;
  /** Reintentos por fragmento ante fallo de red o límite de tasa */
  retries?: number;
  /** Pausa entre fragmentos, en ms, para no saturar la API */
  pauseMs?: number;
  /** Fragmentos en vuelo a la vez. 1 = secuencial. */
  concurrency?: number;
  signal?: { aborted: boolean };
  onChunk?: (done: number, total: number) => void;
}

const RATE_LIMIT_HINT = /rate|429|too many|limit|quota|timeout|ETIMEDOUT|fetch failed|502|503|504/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Un error que no se arregla reintentando (key mala, petición inválida). */
function isFatal(message: string): boolean {
  return (
    /401|403|inv[áa]lid|invalid|Falta la API key|no tienes acceso|not have access/i.test(message) &&
    !RATE_LIMIT_HINT.test(message)
  );
}

/**
 * Corre `task` sobre cada índice con como máximo `concurrency` en vuelo,
 * escribiendo cada resultado en su posición. El orden del array de salida no
 * depende del orden de finalización: es lo que permite paralelizar sin que el
 * audio del capítulo salga descolocado.
 */
export async function mapWithConcurrency<T>(
  count: number,
  concurrency: number,
  task: (index: number) => Promise<T>
): Promise<T[]> {
  const results = new Array<T>(count);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), count) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= count) return;
      results[index] = await task(index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Genera el audio de un capítulo completo: trocea, sintetiza con reintentos y
 * une los fragmentos en orden. Los reintentos no son un lujo: un libro son
 * ~700 peticiones y un único fallo de red tiraría una hora de trabajo.
 */
export async function synthesizeChapter(
  text: string,
  opts: ChapterJobOptions
): Promise<{ blob: Blob; warnings: string[]; chunks: number }> {
  const pieces = text.length > opts.maxChunk ? splitLongText(text, opts.maxChunk) : [text];
  const retries = opts.retries ?? 4;
  const warnings = new Set<string>();
  let completed = 0;
  opts.onChunk?.(0, pieces.length);

  const blobs = await mapWithConcurrency(
    pieces.length,
    opts.concurrency ?? 1,
    async (index) => {
      let lastError: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (opts.signal?.aborted) throw new Error("Generación cancelada");
        try {
          const { blob, warnings: ws } = await generateChunk(
            {
              engine: opts.engine,
              model: opts.model,
              freeSuffix: opts.freeSuffix,
              text: pieces[index],
              voice: opts.voice,
              controls: opts.controls,
            },
            opts.keys
          );
          ws.forEach((w) => warnings.add(w));
          completed += 1;
          opts.onChunk?.(completed, pieces.length);
          if (opts.pauseMs) await sleep(opts.pauseMs);
          return blob;
        } catch (err) {
          lastError = err;
          if (opts.signal?.aborted) throw err;
          const message = err instanceof Error ? err.message : String(err);
          if (isFatal(message)) throw err;
          if (attempt === retries) break;
          await sleep(Math.min(30000, 1500 * 2 ** attempt));
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error("Fallo al generar un fragmento del capítulo");
    }
  );

  const merged = blobs.length > 1 ? await mergeAudioBlobs(blobs, "mp3") : blobs[0];
  return { blob: merged, warnings: [...warnings], chunks: blobs.length };
}

/** Etiqueta el capítulo para que los reproductores lo agrupen y lo ordenen. */
export function tagChapter(
  audio: Blob,
  book: EpubBook,
  chapter: EpubChapter,
  position: number,
  total: number,
  voiceTitle: string
): Blob {
  return tagMp3(audio, {
    title: chapter.title,
    album: book.title,
    artist: book.author || voiceTitle,
    albumArtist: book.author || book.title,
    track: `${position}/${total}`,
    genre: "Audiobook",
    comment: `Voz: ${voiceTitle} · Fish Voice Studio`,
  });
}
