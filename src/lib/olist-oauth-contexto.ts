import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const COOKIE_CONTEXTO_OLIST = "olist_oauth_contexto";
type ContextoOAuth = { aplicativoId: string; usuarioId: string; state: string; expiraEm: number };

function chave() {
  const valor = process.env.OLIST_OAUTH_STATE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!valor || valor.length < 32) throw new Error("Proteção do OAuth não configurada.");
  return valor;
}

export function assinarContextoOlist(aplicativoId: string, usuarioId: string, agora = Date.now()) {
  const contexto: ContextoOAuth = { aplicativoId, usuarioId, state: randomUUID(), expiraEm: agora + 10 * 60_000 };
  const corpo = Buffer.from(JSON.stringify(contexto)).toString("base64url");
  const assinatura = createHmac("sha256", chave()).update(`olist-oauth:v1:${corpo}`).digest("base64url");
  return `${corpo}.${assinatura}`;
}

export function verificarContextoOlist(cookie: string | undefined, agora = Date.now()): ContextoOAuth | null {
  if (!cookie || cookie.length > 2048) return null;
  try {
    const partes = cookie.split(".");
    if (partes.length !== 2) return null;
    const esperado = createHmac("sha256", chave()).update(`olist-oauth:v1:${partes[0]}`).digest();
    const recebido = Buffer.from(partes[1], "base64url");
    if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) return null;
    const valor: unknown = JSON.parse(Buffer.from(partes[0], "base64url").toString("utf8"));
    if (!valor || typeof valor !== "object") return null;
    const c = valor as Record<string, unknown>;
    if (typeof c.aplicativoId !== "string" || typeof c.usuarioId !== "string" || typeof c.state !== "string" ||
      typeof c.expiraEm !== "number" || c.expiraEm <= agora || c.expiraEm > agora + 10 * 60_000) return null;
    return { aplicativoId: c.aplicativoId, usuarioId: c.usuarioId, state: c.state, expiraEm: c.expiraEm };
  } catch { return null; }
}
