import { consultarKits, erroApiKits, verificarClienteKits } from "@/lib/kits-estoque-api";
import { importarLoteKits } from "@/lib/kits-estoque-importacao-service";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { composicaoKitSchema } from "@/lib/kits-estoque";

async function autorizar(request: Request, editar = false) {
  const auth = await getUsuarioAutenticado(request);
  const usuario = await prisma.usuario.findUnique({ where: { id: auth.id }, select: { podeEditarEstoque: true, podeVisualizarEstoque: true } });
  if (!auth.aplicativoId || !usuario || !(editar ? usuario.podeEditarEstoque : usuario.podeEditarEstoque || usuario.podeVisualizarEstoque)) throw new Error("Sem permissão.");
  return auth.aplicativoId;
}

export async function GET(request: Request) {
  let aplicativoId: string;
  try { aplicativoId = await autorizar(request); }
  catch { return NextResponse.json({ error: "Acesso negado." }, { status: 403 }); }
  try {
    return NextResponse.json(await consultarKits(prisma, aplicativoId));
  } catch (error) {
    const resposta = erroApiKits(error);
    return NextResponse.json({ error: resposta.error }, { status: resposta.status });
  }
}

export async function PUT(request: Request) {
  let aplicativoId: string;
  try { aplicativoId = await autorizar(request, true); }
  catch { return NextResponse.json({ error: "Acesso negado." }, { status: 403 }); }
  try {
    verificarClienteKits(prisma);
    const parsed = composicaoKitSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const kit = parsed.data;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('baixa-kits-estoque', 0))::text`;
      if (kit.componentes.length) {
        const produtos = await tx.produto.findMany({ where: { aplicativoId, sku: { in: kit.componentes.map((item) => item.sku) }, ativo: true }, select: { sku: true } });
        if (produtos.length !== kit.componentes.length) throw new Error("Todos os componentes devem ser produtos ativos cadastrados neste aplicativo.");
        const encadeados = await tx.componenteKitEstoque.count({ where: { aplicativoId, OR: [
          { kitSku: { in: kit.componentes.map((item) => item.sku) } }, { sku: kit.sku },
        ] } });
        if (encadeados) throw new Error("Kits não podem ser componentes de outros kits. Associe somente produtos individuais.");
      }
      await tx.componenteKitEstoque.deleteMany({ where: { aplicativoId, kitSku: kit.sku } });
      if (kit.componentes.length) await tx.componenteKitEstoque.createMany({ data: kit.componentes.map((item) => ({ ...item, kitSku: kit.sku, aplicativoId })) });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const infraestrutura = erroApiKits(error);
    if (infraestrutura.status === 503) return NextResponse.json({ error: infraestrutura.error }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error && !('code' in error) ? error.message : "Não foi possível salvar a composição." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  let aplicativoId: string;
  try { aplicativoId = await autorizar(request, true); }
  catch { return NextResponse.json({ error: "Acesso negado." }, { status: 403 }); }
  try {
    verificarClienteKits(prisma);
    const leitor = request.body?.getReader();
    if (!leitor) return NextResponse.json({ error: "Informe o lote." }, { status: 400 });
    const decoder = new TextDecoder();
    let texto = "", bytes = 0;
    try {
      while (true) {
        const { done, value } = await leitor.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1_000_000) {
          await leitor.cancel();
          return NextResponse.json({ error: "O lote excede o limite de 1 MB." }, { status: 413 });
        }
        texto += decoder.decode(value, { stream: true });
      }
      texto += decoder.decode();
    } finally { leitor.releaseLock(); }
    const resultado = await importarLoteKits(prisma, aplicativoId, JSON.parse(texto));
    return NextResponse.json(resultado);
  } catch (error) {
    const infraestrutura = erroApiKits(error);
    if (infraestrutura.status === 503) return NextResponse.json({ error: infraestrutura.error }, { status: 503 });
    return NextResponse.json({ error: error instanceof SyntaxError ? "Lote inválido." : error instanceof Error && !("code" in error) ? error.message : "Não foi possível importar o lote. Nenhuma composição foi alterada." }, { status: 400 });
  }
}
