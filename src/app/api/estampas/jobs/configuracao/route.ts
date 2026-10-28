import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { configuracaoJobEstampasSchema } from "@/domain/configuracao-job-estampas";
import { obterConfiguracaoJobEstampas, salvarConfiguracaoJobEstampas } from "@/repositories/configuracao-jobs-repository";

async function autorizar(request: Request) {
  let id: string;
  try { id = (await getUsuarioAutenticado(request)).id; }
  catch { return NextResponse.json({ error: "Não autorizado." }, { status: 401 }); }
  const usuario = await prisma.usuario.findUnique({ where: { id }, select: { podeEditarEstampas: true } });
  return usuario?.podeEditarEstampas ? null
    : NextResponse.json({ error: "Sem permissão para configurar os jobs de estampas." }, { status: 403 });
}

export async function GET(request: Request) {
  try {
    const negado = await autorizar(request);
    if (negado) return negado;
    return NextResponse.json(await obterConfiguracaoJobEstampas(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Erro ao carregar a configuração dos jobs." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const negado = await autorizar(request);
    if (negado) return negado;
    const entrada: unknown = await request.json().catch(() => null);
    const dados = configuracaoJobEstampasSchema.safeParse(entrada);
    if (!dados.success) return NextResponse.json({ error: "Configuração inválida. Informe o estado e listas de até 100 termos ou variantes de 1 a 100 caracteres." }, { status: 400 });
    return NextResponse.json(await salvarConfiguracaoJobEstampas(dados.data));
  } catch {
    return NextResponse.json({ error: "Erro ao salvar a configuração dos jobs." }, { status: 500 });
  }
}
