import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

const entrada = z.object({
  id: z.guid().nullable(),
  aplicativo_pai_id: z.guid(),
  nome: z.string().trim().min(1).max(200),
  endereco: z.string().trim().max(2000).nullable(),
  vendedor_olist_id: z.guid().nullable(),
  meu_cliente_olist_id: z.number().int().positive().max(2147483647).nullable(),
  meu_forma_pagamento_olist_id: z.number().int().positive().max(2147483647).nullable(),
  meu_plano_pagamento_id: z.guid().nullable(),
  meu_tipo_venda_enum: z.enum(["venda", "venda g", "venda pc"]).nullable(),
}).strict();

const tiposVenda = { venda: "VENDA", "venda g": "VENDA_G", "venda pc": "VENDA_PC" } as const;

export async function POST(request: Request) {
  try {
    const autenticado = await getUsuarioAutenticado(request).catch(() => null);
    if (!autenticado) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
    const usuario = await prisma.usuario.findUnique({ where: { id: autenticado.id }, select: { podeVisualizarFornecedores: true, aplicativoId: true } });
    if (!usuario?.podeVisualizarFornecedores) return NextResponse.json({ error: "Sem permissão para cadastrar fornecedores." }, { status: 403 });
    const parsed = entrada.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Informe os dados do fornecedor e um aplicativo pai válidos." }, { status: 400 });
    const body = parsed.data;
    const pai = await prisma.aplicativo.findFirst({ where: { id: body.aplicativo_pai_id, aplicativoPaiId: null }, select: { id: true } });
    if (!pai) return NextResponse.json({ error: "Selecione um aplicativo pai, não uma filial." }, { status: 400 });
    const data = {
      aplicativoPaiId: body.aplicativo_pai_id, nome: body.nome, endereco: body.endereco,
      vendedorOlistId: body.vendedor_olist_id, meuClienteOlistId: body.meu_cliente_olist_id,
      meuFormaPagamentoOlistId: body.meu_forma_pagamento_olist_id, meuPlanoPagamentoId: body.meu_plano_pagamento_id,
      meuTipoVenda: body.meu_tipo_venda_enum ? tiposVenda[body.meu_tipo_venda_enum] : null, updatedAt: new Date(),
    };
    if (body.id) {
      const resultado = await prisma.fornecedor.updateMany({ where: { id: body.id, aplicativoId: usuario.aplicativoId }, data });
      if (!resultado.count) return NextResponse.json({ error: "Fornecedor não encontrado neste aplicativo." }, { status: 404 });
      return NextResponse.json({ id: body.id });
    }
    const fornecedor = await prisma.fornecedor.create({ data: { ...data, aplicativoId: usuario.aplicativoId }, select: { id: true } });
    return NextResponse.json(fornecedor, { status: 201 });
  } catch (error) {
    // Inclui rejeição do trigger em caso de reparentamento concorrente da matriz.
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "P2003" || code === "P2004") return NextResponse.json({ error: "Um dos vínculos do fornecedor é inválido. Atualize os dados e tente novamente." }, { status: 400 });
    return NextResponse.json({ error: "Não foi possível salvar o fornecedor. Tente novamente." }, { status: 500 });
  }
}
