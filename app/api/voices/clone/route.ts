import { jsonError, keysFrom } from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Clonación de voz: reenvía el multipart tal cual a POST /model de Fish Audio.
 * Campos: type=tts, title, description, visibility (private|unlist|public),
 * train_mode=fast, voices (archivos, repetible), texts (transcripciones opcionales).
 */
export async function POST(req: Request) {
  const { fish } = keysFrom(req);
  if (!fish)
    return jsonError("La clonación requiere una API key de Fish Audio (gratis en fish.audio).", 401);

  let incoming: FormData;
  try {
    incoming = await req.formData();
  } catch {
    return jsonError("Se esperaba multipart/form-data");
  }

  const outgoing = new FormData();
  outgoing.set("type", "tts");
  const title = incoming.get("title");
  if (typeof title === "string" && title.trim()) outgoing.set("title", title.trim());
  else return jsonError("El título es obligatorio");

  const description = incoming.get("description");
  if (typeof description === "string" && description.trim()) outgoing.set("description", description.trim());

  const visibility = incoming.get("visibility");
  outgoing.set("visibility", typeof visibility === "string" && visibility ? visibility : "unlist");

  const trainMode = incoming.get("train_mode");
  outgoing.set("train_mode", typeof trainMode === "string" && trainMode ? trainMode : "fast");

  const voices = incoming.getAll("voices").filter((v): v is File => v instanceof File && v.size > 0);
  if (voices.length === 0) return jsonError("Adjunta al menos un audio de referencia");
  for (const voice of voices) outgoing.append("voices", voice, voice.name);

  const texts = incoming
    .getAll("texts")
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  if (texts.length === voices.length) for (const text of texts) outgoing.append("texts", text.trim());

  try {
    const res = await fetch("https://api.fish.audio/model", {
      method: "POST",
      headers: { Authorization: `Bearer ${fish}` },
      body: outgoing,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        data && typeof data.detail === "string"
          ? data.detail
          : data
            ? JSON.stringify(data).slice(0, 400)
            : `${res.status} ${res.statusText}`;
      return jsonError(msg, res.status);
    }
    return Response.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error de red";
    return jsonError(message, 502);
  }
}
