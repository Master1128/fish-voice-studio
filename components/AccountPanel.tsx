"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppKeys } from "@/lib/client";
import { apiFetch } from "@/lib/client";
import { MODELS, PRICING_STT_PER_HOUR, PRICING_TTS_PER_M_CHARS } from "@/lib/constants";
import { Badge, Btn, Spinner } from "./ui";

interface Props {
  keys: AppKeys;
  onOpenSettings: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}

export function AccountPanel({ keys, onOpenSettings, toast }: Props) {
  const [credits, setCredits] = useState<{ balance: string; totalUsed: string } | null>(null);
  const [loadingCredits, setLoadingCredits] = useState(false);
  const [fishStatus, setFishStatus] = useState<"unknown" | "ok" | "fail">("unknown");
  const [countdown, setCountdown] = useState<{ days: number; hours: number } | null>(null);

  useEffect(() => {
    const update = () => {
      const ms = Math.max(0, Date.parse("2026-09-18T00:00:00Z") - Date.now());
      setCountdown({
        days: Math.ceil(ms / 86400000),
        hours: Math.floor(ms / 3600000) % 24,
      });
    };
    update();
    const t = setInterval(update, 60_000);
    return () => clearInterval(t);
     
  }, []);

  const refreshCredits = useCallback(async () => {
    if (!keys.gw) {
      toast("Configura primero tu API key del Gateway", "error");
      onOpenSettings();
      return;
    }
    setLoadingCredits(true);
    try {
      const data = await apiFetch<{ balance: string; totalUsed: string }>("/api/credits", keys);
      setCredits(data);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error consultando créditos", "error");
    } finally {
      setLoadingCredits(false);
    }
  }, [keys, toast, onOpenSettings]);

  useEffect(() => {
    if (keys.gw) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      refreshCredits();
    }
    if (keys.fish) {
      apiFetch("/api/voices?self=true&page_size=1", keys)
        .then(() => setFishStatus("ok"))
        .catch(() => setFishStatus("fail"));
    }
  }, [keys, refreshCredits]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* promo */}
      <section className="overflow-hidden rounded-2xl border border-cyan-800/50 bg-gradient-to-br from-cyan-950/40 via-zinc-900/60 to-teal-950/30 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-cyan-200">
              Modelos Fish Audio gratis en Vercel AI Gateway
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-zinc-400">
              Todos los modelos <span className="font-mono text-cyan-300">fish-audio/*</span> son
              gratuitos hasta el <strong>18 de septiembre de 2026</strong>. Después, las llamadas con
              el nombre estándar empiezan a facturar automáticamente; con el sufijo{" "}
              <span className="font-mono">-free</span> simplemente dejan de funcionar.
            </p>
          </div>
          <div className="rounded-xl border border-cyan-700/40 bg-zinc-950/60 px-5 py-3 text-center">
            <p className="text-3xl font-extrabold text-cyan-300">{countdown?.days ?? "—"}</p>
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">días restantes</p>
            <p className="mt-0.5 text-[10px] text-zinc-600">+{countdown?.hours ?? "—"} h</p>
          </div>
        </div>
      </section>

      {/* keys y créditos */}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            API key de Vercel AI Gateway
            {keys.gw ? <Badge tone="green">configurada</Badge> : <Badge tone="amber">falta</Badge>}
          </h3>
          <p className="text-xs leading-relaxed text-zinc-500">
            Necesaria para TTS y transcripción. Se guarda solo en tu navegador (localStorage) y se
            envía únicamente a las rutas locales de esta app.
          </p>
          {credits && (
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                <p className="text-lg font-bold text-emerald-300">${credits.balance}</p>
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">balance</p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                <p className="text-lg font-bold text-zinc-300">${credits.totalUsed}</p>
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">gastado</p>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Btn onClick={refreshCredits} disabled={loadingCredits}>
              {loadingCredits ? <Spinner /> : "⟳"} Comprobar créditos
            </Btn>
            <Btn variant="ghost" onClick={onOpenSettings}>
              Ajustes
            </Btn>
          </div>
          <a
            href="https://vercel.com/dashboard/ai-gateway/keys"
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs text-cyan-400 underline hover:text-cyan-300"
          >
            vercel.com/dashboard/ai-gateway/keys → crear key
          </a>
        </section>

        <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            API key de Fish Audio
            {fishStatus === "ok" && <Badge tone="green">válida</Badge>}
            {fishStatus === "fail" && <Badge tone="red">inválida</Badge>}
            {!keys.fish && <Badge>opcional</Badge>}
          </h3>
          <p className="text-xs leading-relaxed text-zinc-500">
            Solo necesaria para <strong>clonar voces</strong>, listar tus voces privadas y el modo
            «Fish directo». La cuenta gratuita de fish.audio sirve.
          </p>
          <Btn variant="ghost" onClick={onOpenSettings}>
            Ajustes
          </Btn>
          <a
            href="https://fish.audio/settings/api-keys"
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs text-cyan-400 underline hover:text-cyan-300"
          >
            fish.audio → Settings → API keys
          </a>
        </section>
      </div>

      {/* modelos y precios */}
      <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
        <h3 className="text-sm font-semibold text-zinc-200">Modelos y precios (fuera de promo)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr className="border-b border-zinc-800">
                <th className="px-3 py-2 font-medium">Modelo</th>
                <th className="px-3 py-2 font-medium">Uso</th>
                <th className="px-3 py-2 font-medium">Precio normal</th>
                <th className="px-3 py-2 font-medium">Ahora</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              {MODELS.map((m) => (
                <tr key={m.id} className="border-b border-zinc-800/60">
                  <td className="px-3 py-2 font-mono text-cyan-300">fish-audio/{m.id}</td>
                  <td className="px-3 py-2">Texto a voz · {m.languages}</td>
                  <td className="px-3 py-2">${PRICING_TTS_PER_M_CHARS} / M caracteres</td>
                  <td className="px-3 py-2 font-semibold text-emerald-400">Gratis</td>
                </tr>
              ))}
              <tr>
                <td className="px-3 py-2 font-mono text-cyan-300">fish-audio/transcribe-1</td>
                <td className="px-3 py-2">Voz a texto con timestamps</td>
                <td className="px-3 py-2">${PRICING_STT_PER_HOUR} / hora de audio</td>
                <td className="px-3 py-2 font-semibold text-emerald-400">Gratis</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-zinc-600">
          Fuente: <a className="underline hover:text-zinc-400" href="https://vercel.com/changelog/fish-audio-models-now-available-on-ai-gateway-for-free" target="_blank" rel="noreferrer">anuncio oficial de Vercel</a>. Cifras aproximadas; consulta tu dashboard para el detalle exacto.
        </p>
      </section>
    </div>
  );
}
