"use client";

import type { OutputFormat, TtsRequestPayload, TtsResponse, VoiceItem } from "./types";
import { MIME_BY_EXT, mimeForFormat } from "./constants";

export interface AppKeys {
  gw: string;
  fish: string;
}

// ---------- persistencia local ----------

const LS_KEYS = "fvs.keys";
const LS_FAVS = "fvs.favorites";
const LS_MY_VOICES = "fvs.myVoices";

export function loadKeys(): AppKeys {
  if (typeof window === "undefined") return { gw: "", fish: "" };
  try {
    const raw = localStorage.getItem(LS_KEYS);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { gw: "", fish: "" };
}

export function saveKeys(keys: AppKeys) {
  localStorage.setItem(LS_KEYS, JSON.stringify(keys));
}

export function loadFavorites(): VoiceItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(LS_FAVS) || "[]");
  } catch {
    return [];
  }
}

export function saveFavorites(items: VoiceItem[]) {
  localStorage.setItem(LS_FAVS, JSON.stringify(items.slice(0, 100)));
}

export function loadMyVoices(): VoiceItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(LS_MY_VOICES) || "[]");
  } catch {
    return [];
  }
}

export function saveMyVoices(items: VoiceItem[]) {
  localStorage.setItem(LS_MY_VOICES, JSON.stringify(items.slice(0, 200)));
}

// ---------- API ----------

export async function apiFetch<T>(
  path: string,
  keys: AppKeys,
  init?: RequestInit
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (keys.gw) headers.set("x-gw-key", keys.gw);
  if (keys.fish) headers.set("x-fish-key", keys.fish);
  const res = await fetch(path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `${res.status} ${res.statusText}`);
  }
  return data as T;
}

export async function generateChunk(
  payload: TtsRequestPayload,
  keys: AppKeys
): Promise<{ blob: Blob; warnings: string[] }> {
  const data = await apiFetch<TtsResponse>("/api/tts", keys, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const bytes = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
  return {
    blob: new Blob([bytes], { type: mimeForFormat(payload.controls.outputFormat) }),
    warnings: data.warnings || [],
  };
}

// ---------- división de texto largo ----------

/**
 * Divide texto largo en fragmentos que respetan oraciones y párrafos.
 * Sin pérdidas (los decimales tipo "3.5" no rompen frases) y sin cortar
 * palabras: una frase más larga que el máximo se corta por comas o espacios.
 */
export function splitLongText(text: string, maxLen = 450): string[] {
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };

  const addPiece = (piece: string) => {
    piece = piece.trim();
    if (!piece) return;
    if (current && (current + " " + piece).length > maxLen) flush();
    while (piece.length > maxLen) {
      const comma = piece.lastIndexOf(", ", maxLen);
      const space = piece.lastIndexOf(" ", maxLen);
      let cut: number;
      if (comma > maxLen / 2) cut = comma + 1;
      else if (space > maxLen / 2) cut = space;
      else cut = maxLen; // palabra continua más larga que el segmento
      const head = piece.slice(0, cut).trim();
      if (head) chunks.push(head);
      piece = piece.slice(cut).trim();
    }
    current = current ? `${current} ${piece}` : piece;
  };

  for (const paragraph of text.split(/\n{2,}/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    for (const sentence of trimmed.split(/(?<=[.!?…])\s+/)) addPiece(sentence);
  }
  flush();
  return chunks;
}

// ---------- fusión de audio ----------

function encodeWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([out], { type: "audio/wav" });
}

/**
 * Une varios blobs de audio del mismo formato.
 * - wav: decodifica y re-codifica un WAV correcto (siempre válido)
 * - pcm: concatenación directa de bytes
 * - mp3/opus: concatenación naive de frames (reproducible en la mayoría de players;
 *   si el reproductor falla, descarga los segmentos por separado)
 */
export async function mergeAudioBlobs(blobs: Blob[], format: OutputFormat): Promise<Blob> {
  if (blobs.length === 1) return blobs[0];
  if (format === "wav") {
    try {
      const ctx = new AudioContext();
      const buffers = await Promise.all(
        blobs.map(async (b) => ctx.decodeAudioData(await b.arrayBuffer()))
      );
      void ctx.close();
      const sampleRate = buffers[0].sampleRate;
      const numChannels = buffers.reduce((m, b) => Math.min(m, b.numberOfChannels), 2) || 1;
      const totalFrames = buffers.reduce((s, b) => s + b.length, 0);
      const offline = new OfflineAudioContext(numChannels, totalFrames, sampleRate);
      let offset = 0;
      for (const buffer of buffers) {
        const source = offline.createBufferSource();
        source.buffer = buffer;
        source.connect(offline.destination);
        source.start(offset / sampleRate);
        offset += buffer.length;
      }
      const rendered = await offline.startRendering();
      return encodeWav(rendered);
    } catch {
      // si el navegador no puede decodificar, caemos a concatenación naive
    }
  }
  const type = blobs[0].type || mimeForFormat(format);
  return new Blob(blobs, { type });
}

/** Re-codifica cualquier blob de audio a WAV PCM16 (para subir grabaciones del navegador). */
export async function audioBlobToWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    return encodeWav(buffer);
  } finally {
    void ctx.close();
  }
}

// ---------- utilidades ----------

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(blob);
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadText(text: string, filename: string, mime = "text/plain") {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function formatDuration(seconds?: number): string {
  if (seconds == null || !isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function srtTime(seconds: number): string {
  const ms = Math.floor((seconds % 1) * 1000);
  const s = Math.floor(seconds) % 60;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function segmentsToSrt(
  segments: { text: string; start?: number; end?: number }[],
  wordsPerCue = 8
): string {
  const cues: { text: string; start: number; end: number }[] = [];
  let current: { text: string; start?: number; end?: number } | null = null;
  for (const seg of segments) {
    if (seg.start == null) continue;
    if (!current || seg.start - (current.start ?? seg.start) > 4 || countWords(current.text) >= wordsPerCue) {
      if (current && current.end != null)
        cues.push({ text: current.text.trim(), start: current.start!, end: current.end });
      current = { text: seg.text, start: seg.start, end: seg.end };
    } else {
      current.text += ` ${seg.text}`;
      current.end = seg.end ?? current.end;
    }
  }
  if (current && current.start != null && current.end != null)
    cues.push({ text: current.text.trim(), start: current.start, end: current.end });

  return cues
    .map((cue, i) => `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`)
    .join("\n");
}

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function guessMediaType(filename: string, fallbackType: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return MIME_BY_EXT[ext] || fallbackType || "audio/mpeg";
}

export function daysUntilPromoEnd(now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse("2026-09-18T00:00:00Z") - now) / 86400000));
}
