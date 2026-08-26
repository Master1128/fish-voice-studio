"use client";

import { useEffect, useRef, useState } from "react";
import type { VoiceItem } from "@/lib/types";
import { Badge } from "./ui";

// Reproductor compartido: al reproducir una preview se detiene la anterior
let sharedPreview: HTMLAudioElement | null = null;
const previewListeners = new Set<() => void>();

function stopSharedPreview() {
  if (sharedPreview) {
    sharedPreview.pause();
    sharedPreview = null;
  }
  previewListeners.forEach((fn) => fn());
}

export function VoiceAvatar({ title, size = "md" }: { title: string; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-9 w-9 text-sm", md: "h-12 w-12 text-lg", lg: "h-16 w-16 text-2xl" };
  const letter = (title || "?").trim().charAt(0).toUpperCase() || "?";
  const hue = [...title].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-xl font-bold text-white ${sizes[size]}`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 65% 42%), hsl(${(hue + 48) % 360} 70% 30%))`,
      }}
    >
      {letter}
    </div>
  );
}

export function VoiceCard({
  voice,
  onUse,
  onFavorite,
  isFavorite,
  actions,
}: {
  voice: VoiceItem;
  onUse?: (voice: VoiceItem) => void;
  onFavorite?: (voice: VoiceItem) => void;
  isFavorite?: boolean;
  actions?: React.ReactNode;
}) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sampleUrl = voice.samples?.[0]?.audio || null;

  useEffect(() => {
    const listener = () => setPlaying(false);
    previewListeners.add(listener);
    return () => {
      previewListeners.delete(listener);
    };
  }, []);

  const togglePreview = () => {
    if (!sampleUrl) return;
    if (playing) {
      stopSharedPreview();
      setPlaying(false);
      return;
    }
    stopSharedPreview();
    const audio = new Audio(sampleUrl);
    audioRef.current = audio;
    sharedPreview = audio;
    audio.onended = () => {
      setPlaying(false);
      if (sharedPreview === audio) sharedPreview = null;
    };
    audio.play().catch(() => setPlaying(false));
    setPlaying(true);
  };

  useEffect(
    () => () => {
      if (audioRef.current && sharedPreview === audioRef.current) stopSharedPreview();
    },
    []
  );

  return (
    <div className="group flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-600">
      <div className="flex items-start gap-3">
        <VoiceAvatar title={voice.title} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-sm font-semibold text-zinc-100" title={voice.title}>
              {voice.title}
            </h3>
            {onFavorite && (
              <button
                onClick={() => onFavorite(voice)}
                title={isFavorite ? "Quitar de favoritos" : "Añadir a favoritos"}
                className={`shrink-0 cursor-pointer text-sm transition-transform hover:scale-125 ${isFavorite ? "text-rose-400" : "text-zinc-600 hover:text-zinc-400"}`}
              >
                {isFavorite ? "♥" : "♡"}
              </button>
            )}
          </div>
          <p className="truncate text-[11px] text-zinc-500">
            {voice.author?.nickname || "—"}
            {voice.task_count ? ` · ${(voice.task_count / 1000).toFixed(1)}k usos` : ""}
            {voice.like_count ? ` · ${(voice.like_count / 1000).toFixed(1)}k ♥` : ""}
          </p>
        </div>
      </div>

      {voice.description && (
        <p className="line-clamp-2 text-xs leading-relaxed text-zinc-400">{voice.description}</p>
      )}

      {voice.tags && voice.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {(voice.visibility === "private" || voice.visibility === "unlist") && (
            <Badge tone={voice.visibility === "private" ? "amber" : "cyan"}>
              {voice.visibility === "private" ? "🔒 privada" : "🔗 no listada"}
            </Badge>
          )}
          {voice.state && voice.state !== "trained" && <Badge tone="amber">estado: {voice.state}</Badge>}
          {voice.languages?.slice(0, 3).map((l) => (
            <Badge key={l}>{l.toUpperCase()}</Badge>
          ))}
          {voice.tags.slice(0, 4).map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center gap-2">
        <button
          onClick={togglePreview}
          disabled={!sampleUrl}
          className={`flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
            playing
              ? "border-cyan-400 bg-cyan-500/20 text-cyan-300"
              : "border-zinc-700 text-zinc-300 hover:border-cyan-600 hover:text-cyan-300"
          }`}
          title={sampleUrl ? "Escuchar muestra" : "Sin muestra disponible"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        {onUse && (
          <BtnUse onUse={onUse} voice={voice} />
        )}
        {actions}
      </div>
    </div>
  );
}

function BtnUse({ onUse, voice }: { onUse: (v: VoiceItem) => void; voice: VoiceItem }) {
  return (
    <button
      onClick={() => onUse(voice)}
      className="flex-1 cursor-pointer rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-cyan-600 hover:bg-cyan-900/30 hover:text-cyan-200"
    >
      Usar voz
    </button>
  );
}
