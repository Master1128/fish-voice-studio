import { keysFrom } from "@/lib/server";

export const runtime = "nodejs";

/**
 * Informa a la interfaz de si el servidor ya tiene API keys configuradas
 * (por cabecera del navegador o por variables de entorno). Nunca devuelve las keys.
 */
export async function GET(req: Request) {
  const { gw, fish } = keysFrom(req);
  return Response.json({ gw: !!gw, fish: !!fish });
}
