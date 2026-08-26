"use client";

import { useEffect, useRef, useState } from "react";
import type { TranscribeResponse } from "@/lib/types";
import type { AppKeys } from "@/lib/client";
import {
  apiFetch,
  blobToBase64,
  downloadText,
  formatDuration,
  guessMediaType,
  segmentsToSrt,
} from "@/lib/client";
import { LANGUAGES } from "@/lib/constants";
import { Badge, Btn, EmptyState, Field, Select, Spinner, Toggle } from "./ui";

import type { KeyAvailability } from "./Studio";

interface Props {
  keys: AppKeys;
  avail: KeyAvailability;
  onOpenSettings: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  lastAudio: Blob | null;
}

export function SttStudio({ keys, avail, onOpenSettings, toast, lastAudio }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [language, setLanguage] = useState("");
  const [ignoreTimestamps, setIgnoreTimestamps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TranscribeResponse | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);

  const setAudioFile = (f: File) => {
    setFile(f);
    setResult(null);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setObjectUrl(URL.createObjectURL(f));
  };

  useEffect(() => {
    const el = dragRef.current;
    if (!el) return;
    const onOver = (e: DragEvent) => {
      e.preventDefault();
      el.classList.add("border-cyan-500/60", "bg-cyan-950/10");
    };
    const onLeave = () => el.classList.remove("border-cyan-500/60", "bg-cyan-950/10");
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      el.classList.remove("border-cyan-500/60", "bg-cyan-950/10");
      const f = e.dataTransfer?.files?.[0];
      if (f) setAudioFile(f);
    };
    el.addEventListener("dragover", onOver);
    el.addEventListener("dragleave", onLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onOver);
      el.removeEventListener("dragleave", onLeave);
      el.removeEventListener("drop", onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useLastAudio = () => {
    if (!lastAudio) return;
    setFile(new File([lastAudio], "ultimo-generado.mp3", { type: lastAudio.type || "audio/mpeg" }));
    setResult(null);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setObjectUrl(URL.createObjectURL(lastAudio));
  };

  const transcribeAudio = async () => {
    if (!file) return;
    if (!avail.gw) {
      toast("Configura tu API key de Vercel AI Gateway", "error");
      onOpenSettings();
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const base64 = await blobToBase64(file);
      const data = await apiFetch<TranscribeResponse>(
        "/api/transcribe",
        keys,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audio: base64,
            mediaType: guessMediaType(file.name, file.type),
            language: language || undefined,
            ignoreTimestamps,
          }),
        }
      );
      setResult(data);
      toast("Transcripción completada", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error transcribiendo", "error");
    } finally {
      setBusy(false);
    }
  };

  const baseName = (file?.name || "transcripcion").replace(/\.[^.]+$/, "");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
        <h2 className="text-sm font-semibold text-zinc-200">Audio a transcribir</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Modelo <span className="font-mono text-cyan-300">fish-audio/transcribe-1</span> — multilingüe con detección
          automática de idioma y marcas de tiempo por palabra.
        </p>

        <div
          ref={dragRef}
          className="mt-3 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-700 bg-zinc-950/40 px-4 py-8 text-center transition-colors"
        >
          <span className="text-2xl">📝</span>
          <p className="text-sm text-zinc-400">Arrastra un archivo de audio o vídeo</p>
          <div className="flex gap-2">
            <Btn onClick={() => fileRef.current?.click()}>Seleccionar archivo</Btn>
            {lastAudio && <Btn onClick={useLastAudio}>Usar mi último audio generado</Btn>}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,video/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setAudioFile(f);
              e.target.value = "";
            }}
          />
        </div>

        {objectUrl && file && (
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
            <span className="truncate text-xs text-zinc-300">{file.name}</span>
            <audio src={objectUrl} controls className="ml-auto h-8 max-w-[50%]" />
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Idioma (pista opcional)">
            <Select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              options={[{ value: "", label: "Detección automática" }, ...LANGUAGES.map((l) => ({ value: l.code, label: l.label }))]}
            />
          </Field>
          <div className="flex items-end">
            <Toggle
              checked={ignoreTimestamps}
              onChange={setIgnoreTimestamps}
              label="Sin marcas de tiempo"
              hint="Más rápido para audios cortos (<30 s)."
            />
          </div>
        </div>

        <div className="mt-4">
          <Btn variant="primary" size="lg" onClick={transcribeAudio} disabled={!file || busy}>
            {busy ? <Spinner /> : "📝"} Transcribir
          </Btn>
        </div>
      </section>

      {result && (
        <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-200">Resultado</h2>
            {result.language && <Badge tone="cyan">{result.language.toUpperCase()}</Badge>}
            {result.durationInSeconds != null && (
              <Badge>{formatDuration(result.durationInSeconds)} de audio</Badge>
            )}
            {result.segments?.length > 0 && <Badge tone="green">{result.segments.length} palabras</Badge>}
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm leading-relaxed text-zinc-200">
            {result.text || "—"}
          </div>

          <div className="flex flex-wrap gap-2">
            <Btn
              onClick={() => {
                navigator.clipboard.writeText(result.text);
                toast("Transcripción copiada", "success");
              }}
            >
              Copiar texto
            </Btn>
            <Btn onClick={() => downloadText(result.text, `${baseName}.txt`)}>Descargar .txt</Btn>
            {result.segments?.length > 0 && (
              <Btn onClick={() => downloadText(segmentsToSrt(result.segments), `${baseName}.srt`)}>
                Descargar .srt
              </Btn>
            )}
            <Btn
              onClick={() =>
                downloadText(JSON.stringify(result, null, 2), `${baseName}.json`, "application/json")
              }
            >
              Descargar .json
            </Btn>
          </div>

          {result.segments?.length > 0 && (
            <details className="rounded-xl border border-zinc-800 bg-zinc-950/40">
              <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-400">
                Marcas de tiempo por palabra
              </summary>
              <div className="max-h-64 overflow-y-auto border-t border-zinc-800 px-2 py-1">
                {result.segments.map((seg, i) => (
                  <div key={i} className="flex gap-3 px-2 py-1 font-mono text-[11px] hover:bg-zinc-900/60">
                    <span className="w-14 shrink-0 text-right text-cyan-500/80">
                      {seg.start != null ? seg.start.toFixed(2) : "—"}
                    </span>
                    <span className="text-zinc-600">→</span>
                    <span className="w-14 shrink-0 text-cyan-500/80">
                      {seg.end != null ? seg.end.toFixed(2) : "—"}
                    </span>
                    <span className="text-zinc-300">{seg.text}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {(result.warnings?.length ?? 0) > 0 && (
            <div className="space-y-1">
              {result.warnings!.map((w, i) => (
                <p key={i} className="text-[11px] text-amber-400/80">⚠ {w}</p>
              ))}
            </div>
          )}
        </section>
      )}

      {!result && !busy && !file && (
        <EmptyState
          icon="🎙"
          title="Transcribe cualquier audio"
          hint="Sube un archivo, arrastra un vídeo o reutiliza el último audio que generaste en el estudio."
        />
      )}
    </div>
  );
}
