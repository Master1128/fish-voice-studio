"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BibleCitationSettings,
  BibleCitationStyle,
  Engine,
  FishModel,
  GenerationResult,
  OutputFormat,
  TtsControls,
  VoiceItem,
} from "@/lib/types";
import type { AppKeys } from "@/lib/client";
import {
  formatBytes,
  generateChunk,
  mergeAudioBlobs,
  splitLongText,
} from "@/lib/client";
import { MARKERS, MODELS, extForFormat } from "@/lib/constants";
import { normalizeBibleReferences } from "@/lib/bibleReferences";
import { Badge, Btn, Collapsible, Field, Range, Select, Spinner, Toggle } from "./ui";
import { VoiceAvatar } from "./VoiceCard";
import { VoicePicker } from "./VoicePicker";

const DEFAULT_CONTROLS: TtsControls = {
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
  useAdvanced: false,
  chunkLength: 200,
  conditionOnPreviousChunks: true,
  qualityGuard: false,
};

const DEFAULT_BIBLE_CITATIONS: BibleCitationSettings = {
  enabled: true,
  style: "compact",
};

const LS_SETTINGS = "fvs.ttsSettings";

import type { KeyAvailability } from "./Studio";

interface Props {
  keys: AppKeys;
  avail: KeyAvailability;
  onOpenSettings: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  injectVoice: { voice: VoiceItem; seq: number } | null;
  setLastAudio: (blob: Blob | null) => void;
}

export function TtsStudio({ keys, avail, onOpenSettings, toast, injectVoice, setLastAudio }: Props) {
  const [text, setText] = useState("");
  const [engine, setEngine] = useState<Engine>("gateway");
  const [model, setModel] = useState<FishModel>("s2.1-pro");
  const [freeSuffix, setFreeSuffix] = useState(true);
  const [mode, setMode] = useState<"single" | "dialog">("single");
  const [voiceA, setVoiceA] = useState<VoiceItem | null>(null);
  const [voiceB, setVoiceB] = useState<VoiceItem | null>(null);
  const [controls, setControls] = useState<TtsControls>(DEFAULT_CONTROLS);
  const [bibleCitations, setBibleCitations] = useState<BibleCitationSettings>(DEFAULT_BIBLE_CITATIONS);
  const [autoSplit, setAutoSplit] = useState(true);
  const [maxChunk, setMaxChunk] = useState(450);
  const [pickerOpen, setPickerOpen] = useState<null | "A" | "B">(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<GenerationResult[]>([]);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [canceling, setCanceling] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelRef = useRef(false);

  const modelInfo = useMemo(() => MODELS.find((m) => m.id === model)!, [model]);
  const dialogMode = mode === "dialog" && modelInfo.dialog;

  // persistir ajustes
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      if (raw) {
        const s = JSON.parse(raw);
        if (s.text) setText(s.text);
        if (s.model) setModel(s.model);
        if (s.engine) setEngine(s.engine);
        if (typeof s.freeSuffix === "boolean") setFreeSuffix(s.freeSuffix);
        if (s.controls) setControls((c) => ({ ...c, ...s.controls }));
        if (s.bibleCitations && typeof s.bibleCitations === "object") {
          setBibleCitations({
            enabled:
              typeof s.bibleCitations.enabled === "boolean"
                ? s.bibleCitations.enabled
                : DEFAULT_BIBLE_CITATIONS.enabled,
            style: s.bibleCitations.style === "narrated" ? "narrated" : "compact",
          });
        }
        if (typeof s.autoSplit === "boolean") setAutoSplit(s.autoSplit);
        if (s.maxChunk) setMaxChunk(s.maxChunk);
      }
    } catch {}
     
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          LS_SETTINGS,
          JSON.stringify({
            text,
            model,
            engine,
            freeSuffix,
            controls,
            bibleCitations,
            autoSplit,
            maxChunk,
          })
        );
      } catch {}
    }, 600);
    return () => clearTimeout(timer);
  }, [text, model, engine, freeSuffix, controls, bibleCitations, autoSplit, maxChunk]);

  // voz inyectada desde la pestaña Voces
  useEffect(() => {
    if (injectVoice) {
      setVoiceA(injectVoice.voice);
      setMode("single");
      toast(`Voz «${injectVoice.voice.title}» seleccionada`, "success");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectVoice?.seq]);

  const patch = (p: Partial<TtsControls>) => setControls((c) => ({ ...c, ...p }));

  const insertAtCursor = (snippet: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const needsSpaceBefore = start > 0 && !/\s$/.test(text.slice(0, start));
    const insert = (needsSpaceBefore ? " " : "") + snippet + " ";
    const next = text.slice(0, start) + insert + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + insert.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const textForTts = useMemo(
    () => normalizeBibleReferences(text, bibleCitations),
    [text, bibleCitations]
  );

  const chunks = useMemo(() => {
    if (!textForTts.trim()) return [] as string[];
    if (dialogMode || !autoSplit || textForTts.length <= maxChunk) return [textForTts];
    return splitLongText(textForTts, maxChunk);
  }, [textForTts, autoSplit, maxChunk, dialogMode]);

  const estCost = (textForTts.length / 1_000_000) * 15;
  const bibleExpansion = textForTts.length - text.length;

  const generate = useCallback(async () => {
    if (!text.trim()) {
      toast("Escribe el texto que quieres convertir a voz", "error");
      return;
    }
    if (engine === "gateway" && !avail.gw) {
      toast("Primero configura tu API key de Vercel AI Gateway", "error");
      onOpenSettings();
      return;
    }
    if (engine === "fish" && !avail.fish) {
      toast("El modo directo necesita una API key de Fish Audio", "error");
      onOpenSettings();
      return;
    }

    const useDialog = dialogMode && voiceA && voiceB;
    const payloadVoices = useDialog ? [voiceA!._id, voiceB!._id] : undefined;
    const payloadVoice = !useDialog ? voiceA?._id : undefined;
    const textChunks = chunks.length ? chunks : [textForTts];

    setBusy(true);
    cancelRef.current = false;
    setCanceling(false);
    const t0 = performance.now();
    const blobs: Blob[] = [];
    const warnings = new Set<string>();
    try {
      for (let i = 0; i < textChunks.length; i++) {
        if (cancelRef.current) throw new Error("Generación cancelada");
        setProgress({ done: i, total: textChunks.length });
        const { blob, warnings: ws } = await generateChunk(
          {
            engine,
            model,
            freeSuffix,
            text: textChunks[i],
            voice: payloadVoice,
            voices: payloadVoices,
            controls,
          },
          keys
        );
        ws.forEach((w) => warnings.add(w));
        blobs.push(blob);
      }
      const merged =
        blobs.length > 1 ? await mergeAudioBlobs(blobs, controls.outputFormat) : blobs[0];
      const result: GenerationResult = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ts: Date.now(),
        text,
        model,
        engine,
        voiceTitles: useDialog
          ? [voiceA!.title, voiceB!.title]
          : voiceA
            ? [voiceA.title]
            : ["Voz por defecto"],
        format: controls.outputFormat,
        warnings: [...warnings],
        blobUrl: URL.createObjectURL(merged),
        size: merged.size,
        chunks: blobs.length,
        chars: text.length,
        ms: performance.now() - t0,
      };
      setResults((prev) => [result, ...prev].slice(0, 25));
      setLastAudio(merged);
      toast(
        blobs.length > 1
          ? `Generado en ${blobs.length} segmentos y unido en un solo audio`
          : "Audio generado",
        "success"
      );
    } catch (err) {
      if (blobs.length > 0) {
        try {
          const merged = await mergeAudioBlobs(blobs, controls.outputFormat);
          warnings.add("La generación se interrumpió: se conservan los segmentos completados.");
          setResults((prev) =>
            [
              {
                id: `${Date.now()}-partial`,
                ts: Date.now(),
                text,
                model,
                engine,
                voiceTitles: [voiceA?.title || "Voz por defecto"],
                format: controls.outputFormat,
                warnings: [...warnings, err instanceof Error ? err.message : "Error"],
                blobUrl: URL.createObjectURL(merged),
                size: merged.size,
                chunks: blobs.length,
                chars: text.length,
                ms: performance.now() - t0,
              },
              ...prev,
            ].slice(0, 25)
          );
        } catch {}
      }
      toast(err instanceof Error ? err.message : "Error generando audio", "error");
    } finally {
      setBusy(false);
      setCanceling(false);
      setProgress(null);
    }
  }, [text, textForTts, engine, keys, avail, dialogMode, voiceA, voiceB, chunks, model, freeSuffix, controls, toast, onOpenSettings, setLastAudio]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!busy) generate();
    }
  };

  const markers = MARKERS[modelInfo.markers];

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
      {/* ============ columna izquierda: texto + resultados ============ */}
      <div className="space-y-5">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-200">Texto a voz</h2>
            <div className="flex gap-1.5">
              <Btn size="sm" variant="ghost" onClick={() => setText("")}>
                Limpiar
              </Btn>
              <Btn
                size="sm"
                variant="ghost"
                onClick={() =>
                  setText(
                    "Bienvenido a Fish Voice Studio. Este texto se convertirá en audio usando los modelos de Fish Audio, gratis durante la promoción. [softly] ¿Impresionante, verdad?"
                  )
                }
              >
                Ejemplo
              </Btn>
            </div>
          </div>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={10}
            placeholder="Escribe o pega aquí cualquier texto (sin límite: los textos largos se dividen y se unen automáticamente)…&#10;&#10;Ctrl+Enter para generar"
            className="w-full resize-y rounded-xl border border-zinc-700/80 bg-zinc-950/70 p-4 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500/70 focus:outline-none"
          />

          {/* marcadores */}
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] uppercase tracking-wide text-zinc-500">
                {modelInfo.markers === "bracket" ? "Prosodia" : "Emociones"}:
              </span>
              {markers.slice(0, 8).map((m) => (
                <button
                  key={m}
                  onClick={() => insertAtCursor(m)}
                  title={`Insertar ${m} en el cursor`}
                  className="cursor-pointer rounded-md border border-zinc-700/70 bg-zinc-800/40 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300 transition-colors hover:border-cyan-600 hover:text-cyan-300"
                >
                  {m}
                </button>
              ))}
              {dialogMode && (
                <>
                  <button
                    onClick={() => insertAtCursor("<|speaker:0|>")}
                    className="cursor-pointer rounded-md border border-teal-800/70 bg-teal-950/40 px-1.5 py-0.5 font-mono text-[11px] text-teal-300 hover:border-teal-500"
                  >
                    &lt;|speaker:0|&gt;
                  </button>
                  <button
                    onClick={() => insertAtCursor("<|speaker:1|>")}
                    className="cursor-pointer rounded-md border border-teal-800/70 bg-teal-950/40 px-1.5 py-0.5 font-mono text-[11px] text-teal-300 hover:border-teal-500"
                  >
                    &lt;|speaker:1|&gt;
                  </button>
                  <Btn
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setText(
                        "<|speaker:0|>Hola, ¿me escuchas bien?<|speaker:1|>¡Perfectamente! Este es un diálogo de ejemplo con dos voces."
                      )
                    }
                  >
                    Plantilla de diálogo
                  </Btn>
                </>
              )}
            </div>
            <p className="text-[11px] text-zinc-500">
              {modelInfo.markers === "bracket"
                ? "Inserta indicaciones entre corchetes para dirigir la entrega (ej. [whispers sweetly])."
                : "Inserta emociones entre paréntesis antes o dentro de la frase."}
            </p>
          </div>

          {/* barra de estado + generar */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-3">
            <div className="text-[11px] text-zinc-500">
              {text.length.toLocaleString()} caracteres originales
              {bibleCitations.enabled && bibleExpansion !== 0
                ? ` · ${textForTts.length.toLocaleString()} enviados al TTS`
                : ""}{" "}
              · {chunks.length > 1 ? `${chunks.length} segmentos` : "1 segmento"} ·{" "}
              {estCost > 0 && (
                <span className="text-emerald-400/90">
                  ~${estCost.toFixed(4)} (gratis durante la promo)
                </span>
              )}
            </div>
            {busy ? (
              <div className="flex items-center gap-3">
                {progress && progress.total > 1 && (
                  <span className="text-xs text-zinc-400">
                    {progress.done + 1}/{progress.total}
                  </span>
                )}
                <Spinner />
                <Btn
                  variant="danger"
                  size="md"
                  disabled={canceling}
                  onClick={() => {
                    cancelRef.current = true;
                    setCanceling(true);
                  }}
                >
                  {canceling ? "Cancelando…" : "Cancelar"}
                </Btn>
              </div>
            ) : (
              <Btn variant="primary" size="lg" onClick={generate} disabled={!text.trim()}>
                🎧 Generar voz
              </Btn>
            )}
          </div>
          {busy && progress && progress.total > 1 && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-teal-400 transition-all"
                style={{ width: `${((progress.done + 0.5) / progress.total) * 100}%` }}
              />
            </div>
          )}
        </section>

        {/* resultados */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-200">
            Generaciones <span className="text-zinc-600">({results.length})</span>
          </h2>
          {results.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 py-10 text-center text-sm text-zinc-500">
              Aún no has generado nada. Escribe un texto y pulsa «Generar voz».
            </div>
          ) : (
            results.map((r) => (
              <ResultCard
                key={r.id}
                result={r}
                duration={durations[r.id]}
                onMeta={(d) => setDurations((prev) => ({ ...prev, [r.id]: d }))}
                onToast={toast}
              />
            ))
          )}
        </section>
      </div>

      {/* ============ columna derecha: configuración ============ */}
      <div className="space-y-4">
        {/* modelo */}
        <section className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h2 className="text-sm font-semibold text-zinc-200">Modelo</h2>
          <div className="space-y-2">
            {MODELS.map((m) => (
              <button
                key={m.id}
                onClick={() => setModel(m.id)}
                className={`w-full cursor-pointer rounded-xl border p-3 text-left transition-colors ${
                  model === m.id
                    ? "border-cyan-500/70 bg-cyan-950/20"
                    : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-600"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-zinc-100">{m.name}</span>
                  {m.recommended && <Badge tone="cyan">recomendado</Badge>}
                  <span className="ml-auto text-[10px] text-zinc-500">{m.languages}</span>
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{m.tagline}</p>
              </button>
            ))}
          </div>
          <Toggle
            checked={freeSuffix}
            onChange={setFreeSuffix}
            label="Sufijo -free"
            hint="Usa fish-audio/{modelo}-free: al acabar la promo deja de servir en vez de cobrar."
          />
        </section>

        {/* motor + voz */}
        <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h2 className="text-sm font-semibold text-zinc-200">Motor y voz</h2>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
            <button
              onClick={() => setEngine("gateway")}
              className={`cursor-pointer rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${engine === "gateway" ? "bg-cyan-500/20 text-cyan-200" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              Vercel Gateway (gratis)
            </button>
            <button
              onClick={() => setEngine("fish")}
              className={`cursor-pointer rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${engine === "fish" ? "bg-cyan-500/20 text-cyan-200" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              Fish directo (tu key)
            </button>
          </div>
          {engine === "fish" && (
            <p className="text-[11px] leading-snug text-amber-400/80">
              El modo directo llama a api.fish.audio con tu propia key (necesario para voces
              privadas; sujeto al límite de tu cuenta de Fish).
            </p>
          )}

          {modelInfo.dialog ? (
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
              <button
                onClick={() => setMode("single")}
                className={`cursor-pointer rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${mode === "single" ? "bg-teal-500/20 text-teal-200" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                Voz única
              </button>
              <button
                onClick={() => setMode("dialog")}
                className={`cursor-pointer rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${mode === "dialog" ? "bg-teal-500/20 text-teal-200" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                Diálogo (2 voces)
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-zinc-500">S1 no admite diálogo multi-voz.</p>
          )}

          <VoiceSlot
            label={dialogMode ? "Voz A — <|speaker:0|>" : "Voz principal"}
            voice={voiceA}
            onPick={() => setPickerOpen("A")}
            onClear={() => setVoiceA(null)}
          />
          {dialogMode && (
            <VoiceSlot
              label="Voz B — <|speaker:1|>"
              voice={voiceB}
              onPick={() => setPickerOpen("B")}
              onClear={() => setVoiceB(null)}
            />
          )}
          {dialogMode && (!voiceA || !voiceB) && (
            <p className="text-[11px] text-amber-400/80">
              Elige las dos voces del diálogo y marca cada turno en el texto con las etiquetas de
              hablante.
            </p>
          )}
          {!voiceA && !dialogMode && (
            <p className="text-[11px] text-zinc-500">
              Sin voz seleccionada se usa la voz por defecto del modelo.
            </p>
          )}
        </section>

        {/* controles de audio */}
        <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h2 className="text-sm font-semibold text-zinc-200">Controles de audio</h2>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Formato">
              <Select
                value={controls.outputFormat}
                onChange={(e) => patch({ outputFormat: e.target.value as OutputFormat })}
                options={[
                  { value: "mp3", label: "MP3 (compatible)" },
                  { value: "wav", label: "WAV (sin pérdida)" },
                  { value: "opus", label: "Opus (eficiente)" },
                  { value: "pcm", label: "PCM (raw)" },
                ]}
              />
            </Field>
            <Field label="Latencia">
              <Select
                value={controls.latency}
                onChange={(e) => patch({ latency: e.target.value as TtsControls["latency"] })}
                options={[
                  { value: "normal", label: "Normal" },
                  { value: "balanced", label: "Equilibrada" },
                  { value: "low", label: "Baja (streaming)" },
                ]}
              />
            </Field>
          </div>

          {controls.outputFormat === "mp3" && (
            <Field label="Bitrate MP3">
              <Select
                value={String(controls.mp3Bitrate)}
                onChange={(e) => patch({ mp3Bitrate: Number(e.target.value) as 64 | 128 | 192 })}
                options={[
                  { value: "64", label: "64 kbps" },
                  { value: "128", label: "128 kbps" },
                  { value: "192", label: "192 kbps" },
                ]}
              />
            </Field>
          )}
          {controls.outputFormat === "opus" && (
            <Field label="Bitrate Opus">
              <Select
                value={String(controls.opusBitrate)}
                onChange={(e) => patch({ opusBitrate: Number(e.target.value) as TtsControls["opusBitrate"] })}
                options={[
                  { value: "24000", label: "24 kbps" },
                  { value: "32000", label: "32 kbps" },
                  { value: "48000", label: "48 kbps" },
                  { value: "64000", label: "64 kbps" },
                ]}
              />
            </Field>
          )}
          {controls.outputFormat !== "opus" && (
            <Field label="Frecuencia de muestreo">
              <Select
                value={String(controls.sampleRate)}
                onChange={(e) => patch({ sampleRate: Number(e.target.value) as 44100 | 48000 })}
                options={[
                  { value: "44100", label: "44.1 kHz" },
                  { value: "48000", label: "48 kHz" },
                ]}
              />
            </Field>
          )}

          <Range
            label="Velocidad"
            min={0.5}
            max={2}
            step={0.05}
            value={controls.speed}
            display={`${controls.speed.toFixed(2)}×`}
            onChange={(e) => patch({ speed: Number(e.target.value) })}
          />
          <Range
            label="Volumen"
            min={-30}
            max={12}
            step={1}
            value={controls.volume}
            display={controls.volume === 0 ? "0 dB (sin cambio)" : `${controls.volume > 0 ? "+" : ""}${controls.volume} dB`}
            onChange={(e) => patch({ volume: Number(e.target.value) })}
          />
          <Toggle
            checked={controls.normalizeLoudness}
            onChange={(v) => patch({ normalizeLoudness: v })}
            label="Normalizar sonoridad"
            hint="Iguala el volumen entre generaciones (familia S2)."
          />

          <Collapsible title="Creatividad">
            <Toggle
              checked={controls.useCreativity}
              onChange={(v) => patch({ useCreativity: v })}
              label="Controlar creatividad"
              hint="Desactivado usa los valores por defecto del modelo."
            />
            {controls.useCreativity && (
              <>
                <Range
                  label="Temperatura (expresividad)"
                  min={0}
                  max={1}
                  step={0.05}
                  value={controls.temperature}
                  display={controls.temperature.toFixed(2)}
                  onChange={(e) => patch({ temperature: Number(e.target.value) })}
                />
                <Range
                  label="Top-P"
                  min={0}
                  max={1}
                  step={0.05}
                  value={controls.topP}
                  display={controls.topP.toFixed(2)}
                  onChange={(e) => patch({ topP: Number(e.target.value) })}
                />
              </>
            )}
          </Collapsible>

          <Collapsible title="Avanzado">
            <Toggle
              checked={controls.useAdvanced}
              onChange={(v) => patch({ useAdvanced: v })}
              label="Ajustes avanzados"
              hint="Chunk length, contexto entre segmentos y quality-guard."
            />
            {controls.useAdvanced && (
              <>
                <Range
                  label="Chunk length (tokens de contexto)"
                  min={100}
                  max={300}
                  step={10}
                  value={controls.chunkLength}
                  display={String(controls.chunkLength)}
                  onChange={(e) => patch({ chunkLength: Number(e.target.value) })}
                />
                <Toggle
                  checked={controls.conditionOnPreviousChunks}
                  onChange={(v) => patch({ conditionOnPreviousChunks: v })}
                  label="Condicionar al chunk anterior"
                  hint="Mantiene la prosodia coherente entre segmentos de textos largos."
                />
                <Toggle
                  checked={controls.qualityGuard}
                  onChange={(v) => patch({ qualityGuard: v })}
                  label="Quality guard"
                  hint="Verifica la calidad del audio generado (puede tardar más)."
                />
              </>
            )}
          </Collapsible>

          <Collapsible title="Pronunciación de citas bíblicas" defaultOpen>
            <Toggle
              checked={bibleCitations.enabled}
              onChange={(enabled) => setBibleCitations((current) => ({ ...current, enabled }))}
              label="Normalizar citas bíblicas"
              hint="Detecta libros y referencias capítulo:versículo; no modifica el texto original."
            />
            {bibleCitations.enabled && (
              <>
                <Field label="Estilo de lectura">
                  <Select
                    value={bibleCitations.style}
                    onChange={(e) =>
                      setBibleCitations((current) => ({
                        ...current,
                        style: e.target.value as BibleCitationStyle,
                      }))
                    }
                    options={[
                      { value: "compact", label: "Compacto — Génesis, uno, uno" },
                      {
                        value: "narrated",
                        label: "Narrado — Génesis, capítulo uno, versículo uno",
                      },
                    ]}
                  />
                </Field>
                <div className="rounded-lg border border-cyan-900/50 bg-cyan-950/20 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
                  <span className="text-zinc-500">Ejemplo:</span>{" "}
                  <span className="text-cyan-300">
                    {normalizeBibleReferences("Juan 3:16-18", bibleCitations)}
                  </span>
                </div>
                <p className="text-[11px] leading-snug text-zinc-500">
                  Solo cambia la copia enviada al sintetizador. El editor, el historial y el texto
                  copiado conservan referencias como “Juan 3:16”.
                </p>
              </>
            )}
          </Collapsible>

          <Collapsible title="Texto largo">
            <Toggle
              checked={autoSplit}
              onChange={setAutoSplit}
              label="División automática"
              hint="Divide textos largos en segmentos por oraciones y une el audio final."
            />
            <Range
              label="Tamaño máximo de segmento"
              min={200}
              max={900}
              step={50}
              value={maxChunk}
              display={`${maxChunk} caracteres`}
              onChange={(e) => setMaxChunk(Number(e.target.value))}
            />
            <p className="text-[11px] leading-snug text-zinc-500">
              WAV se une re-codificando un archivo válido; MP3/Opus se concatenan por frames. En
              modo diálogo la división está desactivada (un solo request con etiquetas de
              hablante).
            </p>
          </Collapsible>
        </section>
      </div>

      <VoicePicker
        open={pickerOpen !== null}
        onClose={() => setPickerOpen(null)}
        keys={keys}
        title={pickerOpen === "B" ? "Elegir voz B (hablante 1)" : "Elegir voz"}
        onSelect={(v) => (pickerOpen === "B" ? setVoiceB(v) : setVoiceA(v))}
      />
    </div>
  );
}

function VoiceSlot({
  label,
  voice,
  onPick,
  onClear,
}: {
  label: string;
  voice: VoiceItem | null;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-2">
      {voice ? (
        <>
          <VoiceAvatar title={voice.title} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-zinc-200">{voice.title}</p>
            <p className="truncate font-mono text-[10px] text-zinc-600">{voice._id.slice(0, 18)}…</p>
          </div>
          <Btn size="sm" variant="ghost" onClick={onPick}>
            Cambiar
          </Btn>
          <button
            onClick={onClear}
            title="Quitar voz"
            className="cursor-pointer rounded-md p-1 text-zinc-600 hover:text-red-400"
          >
            ✕
          </button>
        </>
      ) : (
        <>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-zinc-700 text-zinc-600">
            🎙
          </div>
          <span className="flex-1 text-xs text-zinc-500">{label}</span>
          <Btn size="sm" onClick={onPick}>
            Elegir
          </Btn>
        </>
      )}
    </div>
  );
}

function ResultCard({
  result,
  duration,
  onMeta,
  onToast,
}: {
  result: GenerationResult;
  duration?: number;
  onMeta: (d: number) => void;
  onToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [showText, setShowText] = useState(false);
  const [rate, setRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement>(null);
  const ext = extForFormat(result.format);

  const date = new Date(result.ts);
  const filename = `fish-${result.model}-${date.getHours()}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}.${ext}`;

  return (
    <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
        <Badge tone="cyan">{result.model}</Badge>
        <Badge>{result.engine === "gateway" ? "gateway" : "directo"}</Badge>
        <Badge>{result.format.toUpperCase()}</Badge>
        {result.chunks > 1 && <Badge tone="green">{result.chunks} segmentos unidos</Badge>}
        <span>{new Date(result.ts).toLocaleString()}</span>
        <span className="ml-auto">
          {formatBytes(result.size)}
          {duration ? ` · ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}` : ""}
          {` · ${(result.ms / 1000).toFixed(1)}s`}
        </span>
      </div>

      <audio
        ref={audioRef}
        src={result.blobUrl}
        controls
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (isFinite(d)) onMeta(d);
        }}
        className="w-full"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Btn
          size="sm"
          onClick={() => {
            const a = document.createElement("a");
            a.href = result.blobUrl;
            a.download = filename;
            a.click();
          }}
        >
          ⬇ Descargar {ext.toUpperCase()}
        </Btn>
        <div className="flex items-center gap-1 rounded-lg border border-zinc-800 px-1.5 py-0.5">
          <span className="text-[10px] text-zinc-500">velocidad</span>
          {[0.75, 1, 1.25, 1.5].map((r) => (
            <button
              key={r}
              onClick={() => {
                setRate(r);
                if (audioRef.current) audioRef.current.playbackRate = r;
              }}
              className={`cursor-pointer rounded px-1.5 py-0.5 text-[10px] font-mono ${rate === r ? "bg-cyan-500/20 text-cyan-300" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              {r}×
            </button>
          ))}
        </div>
        <Btn size="sm" variant="ghost" onClick={() => setShowText(!showText)}>
          {showText ? "Ocultar texto" : "Ver texto"}
        </Btn>
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => {
            navigator.clipboard
              .writeText(result.text)
              .then(() => onToast("Texto copiado", "success"))
              .catch(() => onToast("No se pudo copiar", "error"));
          }}
        >
          Copiar texto
        </Btn>
        <span className="ml-auto truncate text-[11px] text-zinc-600" title={result.voiceTitles.join(" · ")}>
          🎙 {result.voiceTitles.join(" · ")}
        </span>
      </div>

      {result.warnings.length > 0 && (
        <div className="space-y-1">
          {result.warnings.map((w, i) => (
            <p key={i} className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-2.5 py-1.5 text-[11px] text-amber-400/90">
              ⚠ {w}
            </p>
          ))}
        </div>
      )}

      {showText && (
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-[11px] leading-relaxed text-zinc-400">
          {result.text}
        </pre>
      )}
    </div>
  );
}
