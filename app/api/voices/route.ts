import { keysFrom } from "@/lib/server";

export const runtime = "nodejs";

const ALLOWED = new Set([
  "page_number",
  "page_size",
  "language",
  "tag",
  "tags",
  "title",
  "self",
  "sort_by",
  "type",
  "precise",
]);

/**
 * Proxy del listado de voces de Fish Audio.
 * El listado público no requiere key; `self=true` necesita la API key de Fish.
 */
export async function GET(req: Request) {
  const { fish } = keysFrom(req);
  const url = new URL(req.url);
  const params = new URLSearchParams();
  url.searchParams.forEach((value, key) => {
    if (ALLOWED.has(key)) params.set(key, value);
  });
  if (!params.get("type")) params.set("type", "tts");

  const headers: Record<string, string> = {};
  if (fish) headers.Authorization = `Bearer ${fish}`;

  try {
    const res = await fetch(`https://api.fish.audio/model?${params.toString()}`, { headers });
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
    return Response.json({ error: message }, { status: 502 });
  }
}
