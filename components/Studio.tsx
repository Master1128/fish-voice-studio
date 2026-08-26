"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceItem } from "@/lib/types";
import type { AppKeys } from "@/lib/client";
import { daysUntilPromoEnd, loadKeys, saveKeys } from "@/lib/client";
import { Badge, Btn, Field, Input, Modal } from "./ui";
import { TtsStudio } from "./TtsStudio";
import { VoiceLibrary } from "./VoiceLibrary";
import { CloneStudio } from "./CloneStudio";
import { SttStudio } from "./SttStudio";
import { AccountPanel } from "./AccountPanel";

type Tab = "studio" | "voices" | "clone" | "stt" | "account";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "studio", label: "Estudio TTS", icon: "🎧" },
  { id: "voices", label: "Voces", icon: "🎭" },
  { id: "clone", label: "Clonar voz", icon: "🧬" },
  { id: "stt", label: "Transcribir", icon: "📝" },
  { id: "account", label: "Cuenta", icon: "👤" },
];

interface Toast {
  id: number;
  msg: string;
  type: "success" | "error" | "info";
}

export function Studio() {
  const [tab, setTab] = useState<Tab>("studio");
  const [keys, setKeys] = useState<AppKeys>({ gw: "", fish: "" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [injectVoice, setInjectVoice] = useState<{ voice: VoiceItem; seq: number } | null>(null);
  const [lastAudio, setLastAudio] = useState<Blob | null>(null);
  const [promoDays, setPromoDays] = useState<number | null>(null);
  const injectSeq = useRef(0);

  useEffect(() => {
    const loaded = loadKeys();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKeys(loaded);
     
    setPromoDays(daysUntilPromoEnd());
  }, []);

  const toast = useCallback((msg: string, type: Toast["type"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const useVoice = useCallback((voice: VoiceItem) => {
    injectSeq.current += 1;
    setInjectVoice({ voice, seq: injectSeq.current });
    setTab("studio");
  }, []);

  const openSettings = useCallback(() => setSettingsOpen(true), []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* fondo decorativo */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute -bottom-40 right-1/4 h-96 w-96 rounded-full bg-teal-500/10 blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6">
        {/* header */}
        <header className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-teal-500 text-xl shadow-lg shadow-cyan-500/30">
              🐟
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Fish Voice Studio</h1>
              <p className="text-[11px] text-zinc-500">
                Playground TTS · Vercel AI Gateway × Fish Audio
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {promoDays != null && (
              <Badge tone="green">gratis · {promoDays} días restantes</Badge>
            )}
            <Btn onClick={openSettings} size="sm">
              🔑 API Keys{" "}
              {!keys.gw && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-amber-400" />}
            </Btn>
          </div>
        </header>

        {/* tabs */}
        <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "bg-zinc-800 text-cyan-300 shadow-inner"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>

        {!keys.gw && tab !== "account" && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-300">
            <span>⚠ Configura tu API key de Vercel AI Gateway para empezar a generar audio gratis.</span>
            <Btn size="sm" onClick={openSettings}>
              Configurar
            </Btn>
          </div>
        )}

        {/* contenido */}
        {tab === "studio" && (
          <TtsStudio
            keys={keys}
            onOpenSettings={openSettings}
            toast={toast}
            injectVoice={injectVoice}
            setLastAudio={setLastAudio}
          />
        )}
        {tab === "voices" && <VoiceLibrary keys={keys} onUseVoice={useVoice} toast={toast} />}
        {tab === "clone" && (
          <CloneStudio keys={keys} onOpenSettings={openSettings} onUseVoice={useVoice} toast={toast} />
        )}
        {tab === "stt" && (
          <SttStudio keys={keys} onOpenSettings={openSettings} toast={toast} lastAudio={lastAudio} />
        )}
        {tab === "account" && <AccountPanel keys={keys} onOpenSettings={openSettings} toast={toast} />}
      </div>

      {/* toasts */}
      <div className="fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur ${
              t.type === "success"
                ? "border-emerald-800/60 bg-emerald-950/80 text-emerald-200"
                : t.type === "error"
                  ? "border-red-800/60 bg-red-950/80 text-red-200"
                  : "border-zinc-700 bg-zinc-900/90 text-zinc-200"
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        keys={keys}
        onSave={(k) => {
          setKeys(k);
          saveKeys(k);
          setSettingsOpen(false);
          toast("API keys guardadas", "success");
        }}
      />
    </div>
  );
}

function SettingsModal({
  open,
  onClose,
  keys,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  keys: AppKeys;
  onSave: (keys: AppKeys) => void;
}) {
  const [gw, setGw] = useState(keys.gw);
  const [fish, setFish] = useState(keys.fish);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGw(keys.gw);
       
      setFish(keys.fish);
    }
  }, [open, keys]);

  return (
    <Modal open={open} onClose={onClose} title="API Keys">
      <div className="space-y-5">
        <Field
          label="Vercel AI Gateway — necesaria"
          hint="Crea una key gratuita en vercel.com/dashboard/ai-gateway/keys. Da acceso a todos los modelos fish-audio gratis durante la promo. Se guarda solo en tu navegador."
        >
          <Input
            type="password"
            value={gw}
            onChange={(e) => setGw(e.target.value)}
            placeholder="vck_…"
            autoComplete="off"
          />
        </Field>
        <Field
          label="Fish Audio — opcional (clonación / voces privadas)"
          hint="Cuenta gratuita en fish.audio → Settings → API keys. Necesaria para clonar voces y usar el modo directo."
        >
          <Input
            type="password"
            value={fish}
            onChange={(e) => setFish(e.target.value)}
            placeholder="fa-…"
            autoComplete="off"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn variant="primary" onClick={() => onSave({ gw: gw.trim(), fish: fish.trim() })}>
            Guardar
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
