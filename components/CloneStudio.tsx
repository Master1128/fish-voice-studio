"use client";

import { useEffect, useRef, useState } from "react";
import type { VoiceItem } from "@/lib/types";
import type { AppKeys } from "@/lib/client";
import { apiFetch, audioBlobToWav, formatBytes, loadMyVoices, saveMyVoices } from "@/lib/client";
import { Badge, Btn, Field, Input, Select, Spinner, TextArea } from "./ui";

interface Clip {
  id: string;
  name: string;
  file: File;
  url: string;
  transcript: string;
}

interface Props {
  keys: AppKeys;
  onOpenSettings: () => void;
  onUseVoice: (voice: VoiceItem) => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}

export function CloneStudio({ keys, onOpenSettings, onUseVoice, toast }: Props) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState("unlist");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<VoiceItem | null>(null);
  const [polling, setPolling] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dragRef = useRef<HTMLDivElement>(null);

  const addFiles = (files: File[]) => {
    const newClips = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      file,
      url: URL.createObjectURL(file),
      transcript: "",
    }));
    if (newClips.length) setClips((prev) => [...prev, ...newClips]);
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
      const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith("audio/") || /\.(wav|mp3|m4a|opus|ogg|flac)$/i.test(f.name));
      addFiles(files);
    };
    el.addEventListener("dragover", onOver);
    el.addEventListener("dragleave", onLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onOver);
      el.removeEventListener("dragleave", onLeave);
      el.removeEventListener("drop", onDrop);
    };
     
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
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
          const wav = await audioBlobToWav(webm);
          addFiles([new File([wav], `grabacion-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.wav`, { type: "audio/wav" })]);
          toast("Grabación añadida (convertida a WAV)", "success");
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
    if (!keys.fish) {
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
      setCreated(voice);
      toast(`Voz creada (${voice.state || "created"}): ${voice._id}`, "success");
      if (voice.state === "trained") finish(voice);
      else pollState(voice._id);
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

  const pollState = (id: string) => {
    setPolling(true);
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      try {
        const voice = await apiFetch<VoiceItem>(`/api/voice/${id}`, keys);
        setCreated(voice);
        if (voice.state === "trained") {
          clearInterval(timer);
          setPolling(false);
          finish(voice);
          toast(`¡Voz «${voice.title}» entrenada y lista!`, "success");
        } else if (voice.state === "failed" || tries > 40) {
          clearInterval(timer);
          setPolling(false);
          if (voice.state === "failed") toast("El entrenamiento falló", "error");
        }
      } catch {
        if (tries > 40) {
          clearInterval(timer);
          setPolling(false);
        }
      }
    }, 3000);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
        <h2 className="text-sm font-semibold text-zinc-200">1 · Audios de referencia</h2>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          Sube entre 1 y 5 clips de 10 s – 2 min: voz limpia, un solo hablante, sin música ni eco.
          Más audio (1–2 minutos en total) = mejor clon. Formatos: WAV, MP3, M4A, Opus.
        </p>

        <div
          ref={dragRef}
          className="mt-3 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-700 bg-zinc-950/40 px-4 py-8 text-center transition-colors"
        >
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
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.opus,.ogg,.flac"
            multiple
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files || []));
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
                  <span className="w-20 text-right text-[11px] text-zinc-500">
                    {formatBytes(clip.file.size)}
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
          {!keys.fish && (
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
          {polling && <p className="text-xs text-zinc-500">Comprobando el entrenamiento cada 3 s…</p>}
          {created.state === "trained" && (
            <div className="flex gap-2">
              <Btn
                variant="primary"
                onClick={() => {
                  setMyVoicesAndPersist(created);
                  onUseVoice(created);
                }}
              >
                Usar en el estudio
              </Btn>
              <Btn
                onClick={() => {
                  navigator.clipboard.writeText(created._id);
                  toast("Id copiado", "success");
                }}
              >
                Copiar id
              </Btn>
            </div>
          )}
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
