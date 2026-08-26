import { jsonError, keysFrom } from "@/lib/server";

export const runtime = "nodejs";

/** Balance de créditos de Vercel AI Gateway. También sirve para validar la key. */
export async function GET(req: Request) {
  const { gw } = keysFrom(req);
  if (!gw) return jsonError("Falta la API key de Vercel AI Gateway", 401);

  try {
    const res = await fetch("https://ai-gateway.vercel.sh/v1/credits", {
      headers: { Authorization: `Bearer ${gw}` },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.message || `Error ${res.status} consultando créditos`);
    }
    const data = await res.json();
    return Response.json({ balance: data.balance, totalUsed: data.total_used });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error consultando créditos";
    return jsonError(message, 502);
  }
}
