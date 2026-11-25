import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { listarReferenciasProducao } from "@/lib/pedido-producao-disponibilidade";

async function disponibilidadeEnvio(usuario: { id: string; aplicativoId: string; podeSolicitarProducao: boolean; podeSelecionarFilialFornecedor: boolean }) {
  if (!usuario.podeSolicitarProducao) return { temFornecedor: false, podeEnviar: false, motivoBloqueio: null };
  try {
    const referencias = await listarReferenciasProducao(usuario);
    const podeEnviar = referencias.some(referencia => !referencia.bloqueio);
    return {
      temFornecedor: referencias.length > 0,
      podeEnviar,
      motivoBloqueio: referencias.length && !podeEnviar
        ? "Seu usuário não possui vendedor vinculado nas contas dos fornecedores. Solicite a configuração ao fornecedor."
        : null,
    };
  } catch {
    // Uma indisponibilidade não significa ausência de fornecedores e não deve
    // impedir consultar os pedidos e detalhes já existentes.
    return { temFornecedor: true, podeEnviar: false, motivoBloqueio: "Não foi possível verificar os fornecedores e vendedores. Atualize a página para tentar novamente." };
  }
}

export async function GET(request: Request) {
  try {
    const autenticado = await getUsuarioAutenticado(request);
    const usuario = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { podeSolicitarProducao: true, podeVisualizarProducao: true, podeConfirmarProducao: true, podeSelecionarFilialFornecedor: true },
    });
    if (!usuario || (!usuario.podeSolicitarProducao && !usuario.podeVisualizarProducao && !usuario.podeConfirmarProducao)) {
      throw new Error("Sem permissão para visualizar solicitações.");
    }

    const [pedidos, filas, envioFornecedor] = await Promise.all([prisma.pedidoFornecedorSolicitacao.findMany({
      where: { solicitacao: { aplicativoId: autenticado.aplicativoId } },
      orderBy: { createdAt: "desc" },
      select: { solicitacaoId: true, pedidoOlistId: true },
    }), prisma.pedidoFornecedorQueue.findMany({
      where: { aplicativoSolicitanteId: autenticado.aplicativoId, solicitacaoProducao: { status: "em_producao" } },
      select: { id: true, solicitacaoProducaoId: true, status: true },
    }), disponibilidadeEnvio({ id: autenticado.id, aplicativoId: autenticado.aplicativoId,
      podeSolicitarProducao: usuario.podeSolicitarProducao, podeSelecionarFilialFornecedor: usuario.podeSelecionarFilialFornecedor })]);
    return NextResponse.json({ pedidos, filas, envioFornecedor }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível carregar os pedidos das solicitações." },
      { status: 403 },
    );
  }
}
