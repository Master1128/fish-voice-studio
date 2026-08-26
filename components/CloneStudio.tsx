"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceItem, VoiceListResponse } from "@/lib/types";
import type { AppKeys } from "@/lib/client";
import { apiFetch, formatBytes, loadMyVoices, prepareVoiceClips, saveMyVoices } from "@/lib/client";
import { Badge, Btn, Field, Input, Select, Spinner, TextArea } from "./ui";

interface Clip {
  id: string;
  name: string;
  file: File;
  url: string;
  transcript: string;
  duration: number; // segundos tras conversión
}

import type { KeyAvailability } from "./Studio";

interface Props {
  keys: AppKeys;
  avail: KeyAvailability;
  onOpenSettings: () => void;
  onUseVoice: (voice: VoiceItem) => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}

export function CloneStudio({ keys, avail, onOpenSettings, onUseVoice, toast }: Props) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState("unlist");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<VoiceItem | null>(null);
  const [polling, setPolling] = useState(false);
  const [pollNote, setPollNote] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [converting, setConverting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voicePollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef<HTMLDivElement>(null);

  /** Convierte los clips a WAV mono 16 kHz (recortados) antes de añadirlos,
   *  para no superar el límite de 4.5 MB de subida de Vercel. */
  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const remainingSlots = Math.max(0, 5 - clips.length);
    const accepted = files.slice(0, remainingSlots);
    if (!accepted.length) {
      toast("Ya tienes el máximo de 5 clips", "info");
      return;
    }
    const usedSeconds = clips.reduce((sum, clip) => sum + clip.duration, 0);
    const remainingSeconds = Math.max(0, 120 - usedSeconds);
    if (remainingSeconds < 1) {
      toast("Ya alcanzaste el máximo de 2 minutos de referencia", "info");
      return;
    }
    setConverting(true);
    try {
      const prepared = await prepareVoiceClips(accepted, remainingSeconds);
      const newClips: Clip[] = prepared.map((p, i) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: accepted[i].name,
        file: p.file,
        url: URL.createObjectURL(p.file),
        transcript: "",
        duration: p.duration,
      }));
      const totalSecs = prepared.reduce((s, p) => s + p.duration, 0);
      setClips((prev) => {
        const next = [...prev, ...newClips];
        if (next.length > 5) return next.slice(0, 5);
        return next;
      });
      toast(
        `${newClips.length} clip(s) preparado(s): ${Math.round(totalSecs)} s en total (mono 16 kHz)`,
        "success"
      );
    } catch (err) {
      toast(
        err instanceof Error ? `No se pudo procesar el audio: ${err.message}` : "No se pudo procesar el audio",
        "error"
      );
    } finally {
      setConverting(false);
    }
  }, [clips, toast]);

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
      const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith("audio/") || /\.(wav|mp3|m4a|opus|ogg|flac)$/i.test(f.name));
      void addFiles(files);
    };
    el.addEventListener("dragover", onOver);
    el.addEventListener("dragleave", onLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onOver);
      el.removeEventListener("dragleave", onLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, [addFiles]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (voicePollTimerRef.current) clearTimeout(voicePollTimerRef.current);
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : undefined;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const webm = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        try {
          await addFiles([
            new File([webm], `grabacion-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`, {
              type: webm.type,
            }),
          ]);
        } catch {
          toast("No se pudo convertir la grabación", "error");
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setRecordSecs(0);
      timerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
    } catch {
      toast("No hay acceso al micrófono", "error");
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const createVoice = async () => {
    if (!avail.fish) {
      toast("La clonación requiere una API key de Fish Audio (gratis)", "error");
      onOpenSettings();
      return;
    }
    if (!title.trim()) return toast("Ponle un nombre a la voz", "error");
    if (clips.length === 0) return toast("Adjunta o graba al menos un audio", "error");

    const fd = new FormData();
    fd.set("title", title.trim());
    fd.set("description", description.trim());
    fd.set("visibility", visibility);
    fd.set("train_mode", "fast");
    clips.forEach((c) => fd.append("voices", c.file, c.file.name));
    const transcripts = clips.map((c) => c.transcript.trim());
    if (transcripts.every(Boolean)) transcripts.forEach((t) => fd.append("texts", t));

    setBusy(true);
    setCreated(null);
    try {
      const voice = await apiFetch<VoiceItem>("/api/voices/clone", keys, { method: "POST", body: fd });
      const id = voice._id || (voice as VoiceItem & { id?: string }).id;
      if (!id) throw new Error("Fish Audio creó la voz pero no devolvió su id");
      const normalized: VoiceItem = { ...voice, _id: id, state: voice.state || "created" };
      setCreated(normalized);
      // Guardarla desde el primer instante: si se recarga la página, el id no se pierde.
      setMyVoicesAndPersist(normalized);
      toast(`Voz creada (${normalized.state}): ${id}`, "success");
      if (normalized.state === "trained") finish(normalized);
      else void pollState(id);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error creando la voz", "error");
    } finally {
      setBusy(false);
    }
  };

  const finish = (voice: VoiceItem) => {
    setMyVoicesAndPersist(voice);
  };

  const setMyVoicesAndPersist = (voice: VoiceItem) => {
    const mine = loadMyVoices();
    const next = [voice, ...mine.filter((v) => v._id !== voice._id)];
    saveMyVoices(next);
  };

  const fetchVoiceState = async (id: string): Promise<VoiceItem> => {
    try {
      return await apiFetch<VoiceItem>(`/api/voice/${id}?t=${Date.now()}`, keys);
    } catch (directErr) {
      // Fallback: algunas voces recién creadas aparecen antes en el listado de la cuenta.
      const list = await apiFetch<VoiceListResponse>(
        `/api/voices?self=true&page_size=100&sort_by=created_at&t=${Date.now()}`,
        keys
      );
      const found = list.items?.find((voice) => voice._id === id);
      if (found) return found;
      throw directErr;
    }
  };

  const pollState = async (id: string, manual = false) => {
    if (voicePollTimerRef.current) clearTimeout(voicePollTimerRef.current);
    setPolling(true);
    setPollNote(manual ? "Consultando Fish Audio…" : "Entrenando en Fish Audio…");
    const startedAt = Date.now();
    let attempts = 0;

    const check = async (): Promise<void> => {
      attempts += 1;
      try {
        const voice = await fetchVoiceState(id);
        const normalized: VoiceItem = {
          ...voice,
          _id: voice._id || id,
          state: voice.state || "created",
        };
        setCreated(normalized);
        setMyVoicesAndPersist(normalized);

        if (normalized.state === "trained") {
          setPolling(false);
          setPollNote("");
          finish(normalized);
          toast(`¡Voz «${normalized.title}» entrenada y lista!`, "success");
          return;
        }
        if (normalized.state === "failed") {
          setPolling(false);
          setPollNote("Fish Audio marcó el entrenamiento como fallido.");
          toast("El entrenamiento de la voz falló", "error");
          return;
        }
      } catch (err) {
        setPollNote(
          `Todavía no se pudo consultar el estado (${err instanceof Error ? err.message : "error temporal"}).`
        );
      }

      const elapsed = Date.now() - startedAt;
      if (manual || elapsed >= 10 * 60_000) {
        setPolling(false);
        setPollNote(
          "La voz está guardada, pero Fish aún no confirmó el entrenamiento. Puedes comprobarla otra vez o verla en Mis voces."
        );
        return;
      }
      setPollNote(`Estado pendiente · intento ${attempts}. Fish puede tardar varios minutos.`);
      voicePollTimerRef.current = setTimeout(() => void check(), 5000);
    };

    await check();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
        <h2 className="text-sm font-semibold text-zinc-200">1 · Audios de referencia</h2>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          Sube hasta 5 clips (WAV, MP3, M4A, Opus): voz limpia, un solo hablante, sin música ni
          eco. Se convierten automáticamente a mono 16 kHz conservando hasta 60 s por clip y 2
          minutos en total (límite de la plataforma). Más audio limpio = mejor clon.
        </p>

        <div
          ref={dragRef}
          className="mt-3 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-700 bg-zinc-950/40 px-4 py-8 text-center transition-colors"
        >
          {converting ? (
            <>
              <Spinner />
              <p className="text-sm text-zinc-400">Convirtiendo a mono 16 kHz…</p>
            </>
          ) : (
            <>
              <span className="text-2xl">📂</span>
              <p className="text-sm text-zinc-400">Arrastra aquí tus audios o</p>
              <div className="flex gap-2">
                <Btn onClick={() => fileRef.current?.click()}>Seleccionar archivos</Btn>
                {recording ? (
                  <Btn variant="danger" onClick={stopRecording}>
                    ⏺ Detener ({recordSecs}s)
                  </Btn>
                ) : (
                  <Btn onClick={startRecording}>🎙 Grabar del micro</Btn>
                )}
              </div>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.opus,.ogg,.flac"
            multiple
            hidden
            onChange={(e) => {
              void addFiles(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
        </div>

        {clips.length > 0 && (
          <div className="mt-4 space-y-2">
            {clips.map((clip, i) => (
              <div key={clip.id} className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10px] text-zinc-500">#{i + 1}</span>
                  <audio src={clip.url} controls className="h-8 flex-1" />
                  <span className="w-28 text-right text-[11px] text-zinc-500" title="Duración conservada y peso tras conversión">
                    {Math.floor(clip.duration / 60)}:{String(Math.round(clip.duration % 60)).padStart(2, "0")} · {formatBytes(clip.file.size)}
                  </span>
                  <button
                    onClick={() => setClips((prev) => prev.filter((c) => c.id !== clip.id))}
                    className="cursor-pointer rounded-md p-1 text-zinc-600 hover:text-red-400"
                    title="Quitar clip"
                  >
                    ✕
                  </button>
                </div>
                <input
                  value={clip.transcript}
                  onChange={(e) =>
                    setClips((prev) => prev.map((c) => (c.id === clip.id ? { ...c, transcript: e.target.value } : c)))
                  }
                  placeholder="Transcripción opcional del clip (mejora la fidelidad)"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-500/60 focus:outline-none"
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
        <h2 className="text-sm font-semibold text-zinc-200">2 · Datos de la voz</h2>
        <Field label="Nombre">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Mi voz" maxLength={80} />
        </Field>
        <Field label="Descripción (opcional)">
          <TextArea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ej.: voz grave en español, tono cálido para narración"
            maxLength={300}
          />
        </Field>
        <Field
          label="Visibilidad"
          hint="unlist: cualquiera con el id puede usarla (recomendado para usarla con el Gateway gratis). private: solo con tu key de Fish en modo directo."
        >
          <Select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
            options={[
              { value: "unlist", label: "No listada (usable vía Gateway)" },
              { value: "private", label: "Privada (solo tu key de Fish)" },
              { value: "public", label: "Pública (aparece en la librería)" },
            ]}
          />
        </Field>

        <div className="flex items-center gap-3 pt-1">
          <Btn variant="primary" size="lg" onClick={createVoice} disabled={busy || !clips.length || !title.trim()}>
            {busy ? <Spinner /> : "🧬"} Crear voz clonada
          </Btn>
          {!avail.fish && (
            <button className="cursor-pointer text-xs text-cyan-400 underline" onClick={onOpenSettings} type="button">
              Configura tu key de Fish Audio (gratis)
            </button>
          )}
        </div>
      </section>

      {created && (
        <section className="space-y-3 rounded-2xl border border-cyan-800/50 bg-cyan-950/10 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-cyan-200">Voz creada</h2>
            {created.state === "trained" ? (
              <Badge tone="green">entrenada ✓</Badge>
            ) : created.state === "failed" ? (
              <Badge tone="red">falló</Badge>
            ) : (
              <Badge tone="amber">estado: {created.state || "creando…"}</Badge>
            )}
            {polling && <Spinner />}
          </div>
          <p className="font-mono text-xs text-zinc-400">{created._id}</p>
          {(polling || pollNote) && (
            <p className="text-xs leading-relaxed text-zinc-500">{pollNote || "Consultando estado…"}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {created.state === "trained" && (
              <Btn
                variant="primary"
                onClick={() => {
                  setMyVoicesAndPersist(created);
                  onUseVoice(created);
                }}
              >
                Usar en el estudio
              </Btn>
            )}
            {created.state !== "trained" && !polling && created.state !== "failed" && (
              <Btn onClick={() => void pollState(created._id, true)}>Comprobar estado ahora</Btn>
            )}
            <Btn
              onClick={() => {
                navigator.clipboard.writeText(created._id);
                toast("Id copiado", "success");
              }}
            >
              Copiar id
            </Btn>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/20 p-5 text-xs leading-relaxed text-zinc-500">
        <p className="mb-2 font-semibold text-zinc-400">Consejos para una clonación perfecta</p>
        <ul className="list-disc space-y-1 pl-4">
          <li>Graba en un sitio silencioso, cerca del micro y sin compresión previa.</li>
          <li>Habla con el tono y la energía que quieres que tenga la voz clonada.</li>
          <li>Incluye varias frases: preguntas, exclamaciones y pausas.</li>
          <li>La transcripción exacta de cada clip mejora la pronunciación.</li>
          <li>El entrenamiento «fast» tarda segundos; la voz queda guardada en tu cuenta de Fish Audio.</li>
        </ul>
      </section>
    </div>
  );
}
