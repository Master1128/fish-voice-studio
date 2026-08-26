import { transcribe } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import { jsonError, keysFrom } from "@/lib/server";
import type { TranscribeResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  audio: string; // base64
  mediaType: string;
  freeSuffix?: boolean;
  language?: string;
  ignoreTimestamps?: boolean;
}

export async function POST(req: Request) {
  const { gw } = keysFrom(req);
  if (!gw) return jsonError("Falta la API key de Vercel AI Gateway. Configúrala en Ajustes.", 401);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonError("Cuerpo JSON inválido");
  }
  if (!body.audio) return jsonError("Falta el audio");
  if (body.audio.length > 40 * 1024 * 1024)
    return jsonError("El audio es demasiado grande (máx. ~30 MB tras codificar)", 413);

  const model = `fish-audio/transcribe-1${body.freeSuffix ? "-free" : ""}`;
  try {
    const gateway = createGateway({ apiKey: gw });
    const audio = Buffer.from(body.audio, "base64");
    const result = await transcribe({
      model: gateway.transcriptionModel(model),
      audio: new Uint8Array(audio),
      mediaType: body.mediaType || "audio/mpeg",
      providerOptions: {
        fishAudio: {
          ...(body.language ? { language: body.language } : {}),
          ignoreTimestamps: body.ignoreTimestamps ?? false,
        },
      },
    } as Parameters<typeof transcribe>[0]);

    const response: TranscribeResponse = {
      text: result.text ?? "",
      segments: (result.segments ?? []).map((s) => ({
        text: s.text ?? "",
        start: s.startSecond,
        end: s.endSecond,
      })),
      language: result.language,
      durationInSeconds: result.durationInSeconds,
      warnings: (result.warnings || []).map((w: unknown) =>
        typeof w === "string" ? w : JSON.stringify(w)
      ),
    };
    return Response.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido en la transcripción";
    console.error(`[/api/transcribe] Falló la transcripción: ${message}`);
    return jsonError(message, 502);
  }
}
