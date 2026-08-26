/** Extrae las API keys de los headers del request, con fallback a variables de entorno. */
export function keysFrom(req: Request): { gw: string; fish: string } {
  return {
    gw: req.headers.get("x-gw-key") || process.env.AI_GATEWAY_API_KEY || "",
    fish: req.headers.get("x-fish-key") || process.env.FISH_AUDIO_API_KEY || "",
  };
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/** Lee el mensaje de error de una respuesta fallida (JSON o texto). */
export async function readErrorMessage(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      const detail = data?.detail ?? data?.message ?? data?.error;
      if (detail) {
        if (typeof detail === "string") return detail;
        return JSON.stringify(detail);
      }
      return text.slice(0, 400);
    } catch {
      return text.slice(0, 400) || `${res.status} ${res.statusText}`;
    }
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}
