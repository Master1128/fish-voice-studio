import { jsonError, keysFrom } from "@/lib/server";

export const runtime = "nodejs";

/** Obtiene una voz por su id (requiere key de Fish para voces propias/privadas). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { fish } = keysFrom(req);
  const { id } = await ctx.params;
  if (!id) return jsonError("Falta el id");

  try {
    const res = await fetch(`https://api.fish.audio/model/${id}?_=${Date.now()}`, {
      headers: fish ? { Authorization: `Bearer ${fish}` } : {},
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      return Response.json(
        { error: typeof data?.detail === "string" ? data.detail : JSON.stringify(data).slice(0, 300) },
        { status: res.status }
      );
    }
    return Response.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error de red";
    return jsonError(message, 502);
  }
}
