import { z } from "zod";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { lerCorpoLimitado } from "@/lib/ler-corpo-limitado";
import { ErroTrabalhoIa, type EscopoIa } from "./contrato";

export async function sessaoIa(request: Request): Promise<EscopoIa> {
  try { const u = await getUsuarioAutenticado(request); return { id:u.id,aplicativoId:u.aplicativoId }; }
  catch { throw new ErroTrabalhoIa("Sua sessão expirou. Entre novamente.",401); }
}
export async function corpoIa(request: Request, limite=40_000): Promise<unknown> {
  const texto=await lerCorpoLimitado(request,limite);
  if (texto===null) throw new ErroTrabalhoIa("Conteúdo acima do limite permitido.",413);
  return JSON.parse(texto);
}
export function jsonIa(dados: unknown, status=200) {
  return Response.json(dados,{status,headers:{"Cache-Control":"private, no-store"}});
}
export function erroIa(error: unknown) {
  if (error instanceof ErroTrabalhoIa) return jsonIa({error:error.message},error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return jsonIa({error:"Revise os dados informados."},400);
  console.error("[trabalhos-ia] Falha interna.",{tipo:error instanceof Error ? error.name : "UnknownError"});
  return jsonIa({error:"O serviço de trabalhos IA está indisponível. Tente novamente em instantes."},503);
}
