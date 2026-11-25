import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { configuracaoDirecionamentoSchema } from "@/lib/direcionamento-pedidos-contrato";
import { ErroDirecionamentoPedidos, obterConfiguracaoDirecionamento, salvarConfiguracaoDirecionamento } from "@/lib/direcionamento-pedidos";

async function autorizar(request: Request, editar = false) {
  const auth = await getUsuarioAutenticado(request).catch(() => { throw new ErroDirecionamentoPedidos("Sessão inválida ou expirada.", 401); });
  const usuario = await prisma.usuario.findUnique({ where: { id: auth.id }, select: { id: true, ativo: true, aplicativoId: true, podeVisualizarConfiguracao: true, podeEditarConfiguracao: true, aplicativo: { select: { aplicativoPaiId: true } } } });
  if (!usuario?.ativo || !usuario.aplicativoId || (editar ? !usuario.podeEditarConfiguracao : !usuario.podeVisualizarConfiguracao && !usuario.podeEditarConfiguracao)) throw new ErroDirecionamentoPedidos("Sem permissão para acessar configurações.", 403);
  return usuario;
}
function falha(error: unknown) {
  return NextResponse.json({ error: error instanceof ErroDirecionamentoPedidos ? error.message : "Não foi possível acessar o direcionamento. Tente novamente." }, { status: error instanceof ErroDirecionamentoPedidos ? error.status : 500 });
}
export async function GET(request: Request) {
  try {
    const usuario = await autorizar(request);
    if (usuario.aplicativo?.aplicativoPaiId) return NextResponse.json({ disponivel: false });
    const filhos = await prisma.aplicativo.findMany({ where: { aplicativoPaiId: usuario.aplicativoId }, select: { id: true, nome: true }, orderBy: [{ nome: "asc" }, { id: "asc" }], take: 1001 });
    if (filhos.length > 1000) throw new ErroDirecionamentoPedidos("O grupo excede o limite de aplicativos.");
    return NextResponse.json({ disponivel: true, filhos, configuracao: await obterConfiguracaoDirecionamento(usuario.aplicativoId) });
  } catch (error) { return falha(error); }
}
export async function PUT(request: Request) {
  try {
    const usuario = await autorizar(request, true);
    if (usuario.aplicativo?.aplicativoPaiId) throw new ErroDirecionamentoPedidos("Somente o aplicativo pai configura direcionamento.", 403);
    const text = await request.text();
    if (text.length > 150000) throw new ErroDirecionamentoPedidos("Configuração excede o limite permitido.", 400);
    let entrada: unknown;
    try { entrada = JSON.parse(text); } catch { throw new ErroDirecionamentoPedidos("Configuração inválida.", 400); }
    const parsed = configuracaoDirecionamentoSchema.safeParse(entrada);
    if (!parsed.success) throw new ErroDirecionamentoPedidos("Revise regras, condições e aplicativo padrão.", 400);
    return NextResponse.json({ configuracao: await salvarConfiguracaoDirecionamento(usuario.aplicativoId, usuario.id, parsed.data) });
  } catch (error) { return falha(error); }
}
