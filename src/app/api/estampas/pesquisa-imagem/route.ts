import { NextResponse } from "next/server";
import { autorizarPesquisa } from "@/lib/estampas-visuais/autorizar";
import { normalizarImagemVisual, ErroBuscaVisual } from "@/lib/estampas-visuais/imagem";
import { lerUploadVisual } from "@/lib/estampas-visuais/upload";
import { criarConsultaFoto, lerConsultaFoto, limitarConsultaFoto } from "@/lib/estampas-visuais/consulta-foto";
import { analisarFotoPesquisaEstampas } from "@/services/analisarFotoPesquisaEstampas";
import { pesquisarEstampasCatalogo } from "@/services/pesquisarEstampasCatalogoService";
import { entradaParametrosEstampas } from "@/services/parametrosPesquisaEstampas";

export const runtime = "nodejs";
export const maxDuration = 180;
const habilitada = () => process.env.ESTAMPAS_BUSCA_VISUAL_HABILITADA !== "false";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
function falha(erro: unknown) {
  return erro instanceof ErroBuscaVisual ? json({ error: erro.message }, erro.status)
    : json({ error: "Não foi possível pesquisar por imagem. Tente novamente." }, 503);
}
export async function GET(request: Request) {
  try { await autorizarPesquisa(request); return json({ habilitada: habilitada() }); }
  catch (erro) { return falha(erro); }
}
export async function POST(request: Request) {
  try {
    const usuario = await autorizarPesquisa(request);
    if (!habilitada()) throw new ErroBuscaVisual("Busca por imagem desativada. Use a pesquisa por texto.", 503);
    const form = await lerUploadVisual(request);
    const params = form.get("parametros");
    if (typeof params !== "string" || params.length > 8_000) throw new ErroBuscaVisual("Filtros inválidos.");
    let entrada;
    try { entrada = entradaParametrosEstampas(new URLSearchParams(params)); }
    catch { throw new ErroBuscaVisual("Filtros inválidos."); }
    let consultaId = form.get("consultaId");
    let referencia;
    if (typeof consultaId === "string" && consultaId) {
      referencia = lerConsultaFoto(consultaId, usuario.id);
    } else {
      limitarConsultaFoto(usuario.id);
      const foto = form.get("foto");
      if (!(foto instanceof File)) throw new ErroBuscaVisual("Selecione uma foto.");
      const imagem = await normalizarImagemVisual(Buffer.from(await foto.arrayBuffer()));
      referencia = await analisarFotoPesquisaEstampas(imagem.bytes);
      consultaId = criarConsultaFoto(usuario.id, referencia);
    }
    return json({ ...await pesquisarEstampasCatalogo(entrada, referencia), consultaId });
  } catch (erro) { return falha(erro); }
}
