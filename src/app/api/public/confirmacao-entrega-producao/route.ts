import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { aplicativoTemJob, CHAVES_JOB } from "@/lib/aplicativo-jobs";
import {
  confirmarEntregaProducao,
  normalizarItensConfirmacaoProducao,
} from "@/lib/confirmar-producao";
import {
  senhaPublicaConfirmacaoValida,
  validarTokenPublicoConfirmacaoProducao,
} from "@/lib/confirmacao-entrega-producao-publica";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const MAX_TENTATIVAS_SENHA = 5;
const JANELA_TENTATIVAS_MS = 15 * 60 * 1_000;
const MAX_BODY_BYTES = 64 * 1_024;

type RegistroTentativas = { tentativas: number; bloqueadoAte: number };
const globalRateLimit = globalThis as typeof globalThis & {
  confirmacaoProducaoRateLimit?: Map<string, RegistroTentativas>;
};
const tentativasSenha = globalRateLimit.confirmacaoProducaoRateLimit
  ?? new Map<string, RegistroTentativas>();
globalRateLimit.confirmacaoProducaoRateLimit = tentativasSenha;

function resposta(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function erroPublico(error: unknown) {
  const mensagem = error instanceof Error ? error.message : "";
  const prefixosPermitidos = [
    "Link de confirmação inválido",
    "Este link de confirmação expirou",
    "Informe a solicitação",
    "Informe os itens da solicitação",
    "A confirmação excede",
    "Informe quantidades inteiras",
    "Existem itens duplicados",
    "Solicitação não encontrada ou já confirmada",
    "Os itens da solicitação mudaram",
    "Não foi possível confirmar: produtos inexistentes ou inativos",
  ];
  const esperado = prefixosPermitidos.some((prefixo) => mensagem.startsWith(prefixo));
  const autenticacao = mensagem.startsWith("Link de confirmação inválido")
    || mensagem.startsWith("Este link de confirmação expirou");
  return {
    autenticacao,
    esperado,
    mensagem: esperado ? mensagem : "Erro interno ao processar a confirmação.",
  };
}

function obterToken(request: NextRequest) {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!token || token.length > 2_048) throw new Error("Link de confirmação inválido.");
  return token;
}

function obterChaveRateLimit(request: NextRequest, token: string) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "ip-desconhecido";
  return createHash("sha256").update(`${ip}:${token}`).digest("hex");
}

function estaBloqueado(chave: string, agora = Date.now()) {
  const registro = tentativasSenha.get(chave);
  if (!registro) return false;
  if (registro.bloqueadoAte <= agora) {
    tentativasSenha.delete(chave);
    return false;
  }
  return registro.tentativas >= MAX_TENTATIVAS_SENHA;
}

function registrarSenhaInvalida(chave: string, agora = Date.now()) {
  const atual = tentativasSenha.get(chave);
  if (!atual || atual.bloqueadoAte <= agora) {
    tentativasSenha.set(chave, {
      tentativas: 1,
      bloqueadoAte: agora + JANELA_TENTATIVAS_MS,
    });
    return;
  }
  atual.tentativas += 1;
}

async function validarAplicativoHabilitado(aplicativoId: string) {
  const aplicativo = await prisma.aplicativo.findUnique({
    where: { id: aplicativoId },
    select: { id: true, nome: true, jobs: true },
  });
  if (
    !aplicativo
    || !aplicativoTemJob(
      aplicativo.jobs,
      CHAVES_JOB.CONFIRMACAO_ENTREGA_PRODUCAO,
    )
  ) {
    throw new Error("Link de confirmação inválido.");
  }
  return aplicativo;
}

export async function GET(request: NextRequest) {
  try {
    const token = obterToken(request);
    const payload = validarTokenPublicoConfirmacaoProducao(token);
    const aplicativo = await validarAplicativoHabilitado(payload.aplicativoId);
    const solicitacoes = await prisma.solicitacaoProducao.findMany({
      where: {
        id: payload.solicitacaoId,
        aplicativoId: aplicativo.id,
        status: "em_producao",
      },
      select: {
        id: true,
        dataEntrega: true,
        createdAt: true,
        observacaoGeral: true,
        prioridadeProducao: true,
        periodoInicio: true,
        periodoFim: true,
      },
      orderBy: [
        { prioridadeProducao: "desc" },
        { createdAt: "desc" },
      ],
    });
    const solicitacaoIds = solicitacoes.map((solicitacao) => solicitacao.id);
    const [itens, pedidos] = solicitacaoIds.length > 0
      ? await Promise.all([
          prisma.itemSolicitacaoProducao.findMany({
            where: {
              aplicativoId: aplicativo.id,
              solicitacaoId: { in: solicitacaoIds },
            },
            select: {
              id: true,
              solicitacaoId: true,
              sku: true,
              imagemUrl: true,
              quantidadeSolicitada: true,
              tipoCorte: true,
              observacao: true,
            },
            orderBy: { createdAt: "asc" },
          }),
          prisma.pedidoFornecedorSolicitacao.findMany({
            where: {
              solicitacaoId: { in: solicitacaoIds },
              solicitacao: { aplicativoId: aplicativo.id },
            },
            select: { solicitacaoId: true, pedidoOlistId: true },
            orderBy: { createdAt: "desc" },
          }),
        ])
      : [[], []];
    const itensPorSolicitacao = new Map<string, typeof itens>();
    for (const item of itens) {
      const agrupados = itensPorSolicitacao.get(item.solicitacaoId) ?? [];
      agrupados.push(item);
      itensPorSolicitacao.set(item.solicitacaoId, agrupados);
    }
    const pedidosPorSolicitacao = new Map<string, string[]>();
    for (const pedido of pedidos) {
      const agrupados = pedidosPorSolicitacao.get(pedido.solicitacaoId) ?? [];
      agrupados.push(pedido.pedidoOlistId);
      pedidosPorSolicitacao.set(pedido.solicitacaoId, agrupados);
    }

    return resposta({
      aplicativo: { nome: aplicativo.nome },
      solicitacoes: solicitacoes.map((solicitacao) => ({
        id: solicitacao.id,
        dataEntrega: solicitacao.dataEntrega.toISOString().slice(0, 10),
        createdAt: solicitacao.createdAt.toISOString(),
        observacaoGeral: solicitacao.observacaoGeral,
        prioridadeProducao: solicitacao.prioridadeProducao,
        periodoInicio: solicitacao.periodoInicio?.toISOString() ?? null,
        periodoFim: solicitacao.periodoFim?.toISOString() ?? null,
        pedidosOlist: pedidosPorSolicitacao.get(solicitacao.id) ?? [],
        itens: (itensPorSolicitacao.get(solicitacao.id) ?? [])
          .map((item) => ({
            id: item.id,
            sku: item.sku,
            imagemUrl: item.imagemUrl,
            quantidadeSolicitada: item.quantidadeSolicitada,
            tipoCorte: item.tipoCorte,
            observacao: item.observacao,
          })),
      })),
    });
  } catch (error) {
    const falha = erroPublico(error);
    if (!falha.esperado) {
      console.error("[confirmacao-entrega-producao-publica] Falha na listagem:", error);
    }
    return resposta({ error: falha.mensagem }, falha.autenticacao ? 401 : 500);
  }
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return resposta({ error: "Dados enviados excedem o limite permitido." }, 413);
  }

  try {
    const token = obterToken(request);
    const payload = validarTokenPublicoConfirmacaoProducao(token);
    await validarAplicativoHabilitado(payload.aplicativoId);
    const chaveRateLimit = obterChaveRateLimit(request, token);
    if (estaBloqueado(chaveRateLimit)) {
      return resposta(
        { error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." },
        429,
      );
    }

    const textoBody = await request.text();
    if (Buffer.byteLength(textoBody, "utf8") > MAX_BODY_BYTES) {
      return resposta({ error: "Dados enviados excedem o limite permitido." }, 413);
    }
    const body = JSON.parse(textoBody) as {
      solicitacaoId?: unknown;
      senha?: unknown;
      itens?: unknown;
    };
    if (!senhaPublicaConfirmacaoValida(body.senha)) {
      registrarSenhaInvalida(chaveRateLimit);
      return resposta({ error: "Senha inválida." }, 401);
    }
    tentativasSenha.delete(chaveRateLimit);

    const solicitacaoId = typeof body.solicitacaoId === "string"
      ? body.solicitacaoId.trim()
      : "";
    if (!solicitacaoId) return resposta({ error: "Informe a solicitação." }, 400);
    if (solicitacaoId !== payload.solicitacaoId) {
      return resposta({ error: "Link inválido para esta solicitação." }, 403);
    }
    const itensConfirmacao = normalizarItensConfirmacaoProducao(body.itens);
    await confirmarEntregaProducao({
      aplicativoId: payload.aplicativoId,
      solicitacaoId: payload.solicitacaoId,
      itens: itensConfirmacao,
    });

    return resposta({ success: true });
  } catch (error) {
    console.error("[confirmacao-entrega-producao-publica] Falha:", error);
    const falha = erroPublico(error);
    return resposta(
      { error: falha.mensagem },
      falha.autenticacao ? 401 : falha.esperado ? 400 : 500,
    );
  }
}
