import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { ReferenciaFotoEstampa } from "@/domain/referencia-foto-estampa";
import { ErroBuscaVisual } from "./imagem";

function chave() {
  const segredo = process.env.ESTAMPAS_CONSULTA_FOTO_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!segredo) throw new ErroBuscaVisual("Pesquisa por foto não configurada.", 503);
  return createHash("sha256").update(`pesquisa-estampas-foto-v1:${segredo}`).digest();
}
export function criarConsultaFoto(usuario: string, referencia: ReferenciaFotoEstampa, agora = Date.now()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", chave(), iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify({ usuario, referencia, expira: agora + 30 * 60_000 })), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64url");
}
export function lerConsultaFoto(token: string, usuario: string, agora = Date.now()): ReferenciaFotoEstampa {
  try {
    if (token.length > 8_000) throw new Error("Inválido");
    const bytes = Buffer.from(token, "base64url");
    const cipher = createDecipheriv("aes-256-gcm", chave(), bytes.subarray(0,12));
    cipher.setAuthTag(bytes.subarray(12,28));
    const dados = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString());
    if (dados.usuario !== usuario || !Number.isFinite(dados.expira) || dados.expira <= agora) throw new Error("Expirada");
    return dados.referencia;
  } catch { throw new ErroBuscaVisual("A consulta expirou. Envie a foto novamente.", 410); }
}

// Segue o padrão local de limites do projeto. Em múltiplas instâncias, a quota é por instância.
const globalLimites = globalThis as typeof globalThis & { consultasFotoLimites?: Map<string, { ate: number; quantidade: number }> };
const limites = globalLimites.consultasFotoLimites ??= new Map();
export function limitarConsultaFoto(usuario: string, agora = Date.now()) {
  for (const [id, estado] of limites) if (estado.ate <= agora) limites.delete(id);
  const atual = limites.get(usuario) ?? { ate: agora + 60_000, quantidade: 0 };
  if (atual.quantidade >= 6 || (!limites.has(usuario) && limites.size >= 10_000)) throw new ErroBuscaVisual("Limite de consultas atingido. Aguarde um minuto.", 429);
  atual.quantidade++; limites.set(usuario, atual);
}
