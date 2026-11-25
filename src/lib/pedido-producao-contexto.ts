import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const PRAZO_MS = 2 * 60_000;
const schema = z.object({
  usuarioId: z.guid(), aplicativoSolicitanteId: z.guid(), solicitacaoId: z.guid(),
  referenciaId: z.guid(), vendedorOrigemId: z.number().int().positive(), clienteOrigemId: z.number().int().positive(),
  destinoId: z.guid(), matrizId: z.guid(), vendedorDestinoId: z.number().int().positive(),
  vinculosVersao: z.number().int().nonnegative(), podeSelecionarFilial: z.boolean(),
  regraTipo: z.enum(["REGRA", "PADRAO", "CONTA_UNICA"]), regraVersao: z.number().int().nonnegative(),
  expiraEm: z.number().int().positive(),
}).strict();
export type ContextoConsultaProducao = z.infer<typeof schema>;
export class ErroContextoConsultaProducao extends Error {
  constructor() { super("Atualize o direcionamento para continuar as consultas."); }
}
function chave() {
  const segredo = process.env.OLIST_OAUTH_STATE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!segredo || segredo.length < 32) throw new Error("Proteção das consultas não configurada.");
  return segredo;
}
/** Não contém nomes/documentos nem credenciais; válido apenas para consultas curtas. */
export function assinarConsultaProducao(contexto: Omit<ContextoConsultaProducao, "expiraEm">, agora = Date.now()) {
  const corpo = Buffer.from(JSON.stringify(schema.parse({ ...contexto, expiraEm: agora + PRAZO_MS }))).toString("base64url");
  const assinatura = createHmac("sha256", chave()).update(`pedido-producao-consulta:v1:${corpo}`).digest("base64url");
  return `${corpo}.${assinatura}`;
}
export function lerConsultaProducao(token: string, agora = Date.now()): ContextoConsultaProducao {
  try {
    if (token.length > 2500) throw new Error();
    const partes = token.split(".");
    if (partes.length !== 2) throw new Error();
    const esperado = createHmac("sha256", chave()).update(`pedido-producao-consulta:v1:${partes[0]}`).digest();
    const recebido = Buffer.from(partes[1], "base64url");
    if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) throw new Error();
    const contexto = schema.parse(JSON.parse(Buffer.from(partes[0], "base64url").toString("utf8")));
    if (contexto.expiraEm <= agora || contexto.expiraEm > agora + PRAZO_MS) throw new Error();
    return contexto;
  } catch { throw new ErroContextoConsultaProducao(); }
}
