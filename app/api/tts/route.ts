import { generateSpeech } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import { jsonError, keysFrom, readErrorMessage } from "@/lib/server";
import type { TtsRequestPayload, TtsResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const VALID_MODELS = new Set(["s2.1-pro", "s2-pro", "s1"]);

export async function POST(req: Request) {
  let body: TtsRequestPayload;
  try {
    body = (await req.json()) as TtsRequestPayload;
  } catch {
    return jsonError("Cuerpo JSON inválido");
  }

  const { gw, fish } = keysFrom(req);
  const text = (body.text || "").trim();
  const controls = body.controls || ({} as TtsRequestPayload["controls"]);

  if (!text) return jsonError("El texto no puede estar vacío");
  if (!VALID_MODELS.has(body.model)) return jsonError("Modelo inválido");
  if (body.engine === "gateway" && !gw)
    return jsonError("Falta la API key de Vercel AI Gateway. Configúrala en Ajustes.", 401);
  if (body.engine === "fish" && !fish)
    return jsonError("Falta la API key de Fish Audio. Configúrala en Ajustes.", 401);

  const model = body.freeSuffix ? `${body.model}-free` : body.model;
  const multiVoice = Array.isArray(body.voices) && body.voices.length > 0;
  const outputFormat = controls.outputFormat ?? "mp3";

  try {
    let audioBytes: Uint8Array;
    let warnings: string[] = [];

    if (body.engine === "fish") {
      // Modo directo contra la API oficial de Fish Audio (necesario para voces privadas)
      const payload: Record<string, unknown> = {
        text,
        format: outputFormat,
        normalize: true,
        latency: controls.latency ?? "normal",
      };
      if (multiVoice) {
        payload.reference_id = body.voices![0];
      } else if (body.voice) {
        payload.reference_id = body.voice;
      }
      if (outputFormat === "mp3") payload.mp3_bitrate = controls.mp3Bitrate ?? 128;
      if (controls.useAdvanced && controls.chunkLength) payload.chunk_length = controls.chunkLength;
      if (controls.speed != null && controls.speed !== 1) payload.prosody_speed = controls.speed;
      if (controls.volume != null && controls.volume !== 0) payload.prosody_volume = `${controls.volume}dB`;

      const res = await fetch("https://api.fish.audio/v1/tts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${fish}`,
          "Content-Type": "application/json",
          model: body.model,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      audioBytes = new Uint8Array(await res.arrayBuffer());
    } else {
      // Modo Vercel AI Gateway (gratis durante la promo)
      const gateway = createGateway({ apiKey: gw });
      const fishOpts: Record<string, unknown> = {};
      // En modo voz única usamos solo `voice` (la opción estándar);
      // referenceId en array solo para diálogo multi-voz.
      if (multiVoice) {
        fishOpts.referenceId = body.voices;
      }
      if (outputFormat === "mp3") fishOpts.mp3Bitrate = controls.mp3Bitrate ?? 128;
      if (outputFormat === "opus") fishOpts.opusBitrate = controls.opusBitrate ?? 48000;
      if (outputFormat !== "opus") fishOpts.sampleRate = controls.sampleRate ?? 44100;
      fishOpts.latency = controls.latency ?? "normal";
      fishOpts.normalizeLoudness = controls.normalizeLoudness ?? false;
      if (controls.volume != null && controls.volume !== 0) fishOpts.volume = controls.volume;
      if (controls.useCreativity) {
        fishOpts.temperature = controls.temperature ?? 0.8;
        fishOpts.topP = controls.topP ?? 0.7;
      }
      if (controls.useAdvanced) {
        fishOpts.chunkLength = controls.chunkLength ?? 200;
        fishOpts.conditionOnPreviousChunks = controls.conditionOnPreviousChunks ?? true;
        if (controls.qualityGuard) fishOpts.features = ["quality-guard"];
      }

      const speechArgs: Record<string, unknown> = {
        model: gateway.speechModel(`fish-audio/${model}`),
        text,
        outputFormat,
        providerOptions: { fishAudio: fishOpts },
      };
      if (!multiVoice && body.voice) speechArgs.voice = body.voice;
      if (controls.speed != null && controls.speed !== 1) speechArgs.speed = controls.speed;

      const result = await generateSpeech(speechArgs as Parameters<typeof generateSpeech>[0]);
      audioBytes = result.audio.uint8Array;
      warnings = (result.warnings || []).map((w: unknown) =>
        typeof w === "string" ? w : JSON.stringify(w)
      );
    }

    const response: TtsResponse = {
      audio: Buffer.from(audioBytes).toString("base64"),
      warnings,
      model: body.model,
      chars: text.length,
    };
    return Response.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido en la generación";
    const upstream =
      err && typeof err === "object" && "statusCode" in err
        ? ` (HTTP ${(err as { statusCode?: number }).statusCode} del Gateway)`
        : "";
    console.error(`[/api/tts] Falló la generación${upstream}: ${message}`);
    return jsonError(message, 502);
  }
}
