import { z } from "zod";
import { ErroAutorizacaoOlist } from "@/lib/olist-autorizacao";
import { resolverEmpresaOlist } from "@/lib/olist-empresa";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

const chave = z.object({ tipo: z.literal("recebimento"), formaOlistId: z.string().trim().regex(/^[1-9]\d{0,15}$/) });
const entrada = chave.extend({ formaOlistNome: z.string().trim().max(200).optional(), planoIds: z.array(z.guid()).max(100).transform(ids => [...new Set(ids)]) }).strict();
function falha(error: unknown) {
  if (error instanceof ErroAutorizacaoOlist) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ error: "Informe uma forma de recebimento e até 100 planos válidos." }, { status: 400 });
  return NextResponse.json({ error: "Não foi possível consultar ou salvar os planos de recebimento." }, { status: 500 });
}
export async function GET(request: Request) {
  try {
    const usuario = await getUsuarioAutenticado(request);
    if (!usuario.podeVisualizarOlistFormasRecebimento) return NextResponse.json({ error: "Sem permissão para associar planos." }, { status: 403 });
    const aplicativoId = await resolverEmpresaOlist(request, usuario.aplicativoId);
    const params = new URL(request.url).searchParams;
    const { formaOlistId } = chave.parse({ tipo: params.get("tipo"), formaOlistId: params.get("formaOlistId") });
    const [planos, associacoes] = await Promise.all([
      prisma.planoPagamento.findMany({ where: { ativo: true }, select: { id: true, nome: true }, orderBy: [{ nome: "asc" }, { id: "asc" }], take: 1000 }),
      prisma.formaRecebimentoOlistPlano.findMany({ where: { aplicativoId, formaOlistId }, select: { planoPagamentoId: true }, take: 100 }),
    ]);
    return NextResponse.json({ planos, planoIdsAssociados: associacoes.map(a => a.planoPagamentoId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return falha(error); }
}
export async function PUT(request: Request) {
  try {
    const usuario = await getUsuarioAutenticado(request);
    if (!usuario.podeVisualizarOlistFormasRecebimento) return NextResponse.json({ error: "Sem permissão para associar planos." }, { status: 403 });
    const aplicativoId = await resolverEmpresaOlist(request, usuario.aplicativoId);
    const { formaOlistId, formaOlistNome, planoIds } = entrada.parse(await request.json().catch(() => null));
    await prisma.$transaction(async tx => {
      // Serialize concurrent replacements of this application's associations.
      await tx.$queryRaw`SELECT id FROM aplicativo WHERE id=${aplicativoId}::uuid FOR UPDATE`;
      const validos = await tx.planoPagamento.count({ where: { id: { in: planoIds }, ativo: true } });
      if (validos !== planoIds.length) throw new z.ZodError([{ code: "custom", path: ["planoIds"], message: "Plano inativo ou inexistente." }]);
      await tx.formaRecebimentoOlistPlano.deleteMany({ where: { aplicativoId, formaOlistId } });
      if (planoIds.length) await tx.formaRecebimentoOlistPlano.createMany({ data: planoIds.map(planoPagamentoId => ({ aplicativoId, formaOlistId, formaOlistNome: formaOlistNome || null, planoPagamentoId })) });
    });
    return NextResponse.json({ success: true, quantidade: planoIds.length });
  } catch (error) { return falha(error); }
}
