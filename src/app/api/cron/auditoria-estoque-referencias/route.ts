import { NextRequest, NextResponse } from "next/server";
import { aplicativoTemJob, CHAVES_JOB } from "@/lib/aplicativo-jobs";
import { auditarEstoqueReferencias, criarMensagensAuditoria } from "@/lib/auditoria-estoque-referencias";
import { prepararNotificationsAuditoria } from "@/lib/auditoria-estoque-notifications";
import { listarProdutosOlistApi, obterEstoqueProdutoOlistApi } from "@/lib/olist";
import { normalizarDestinatariosWhatsapp } from "@/lib/notification";
import { prisma } from "@/lib/prisma";
import { diagnosticarErroAuditoria, ErroEtapaAuditoria } from "@/lib/auditoria-estoque-erros";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    const limiteEm = Date.now() + 240_000;
    const integracoes = await prisma.integracaoOlistToken.findMany({
      where: { provider: "olist", status: "conectado" },
      select: { aplicativoId: true, aplicativo: { select: { jobs: true, whatsapp: true } } },
      orderBy: { aplicativoId: "asc" },
    });
    const habilitados = integracoes.filter(({ aplicativo }) =>
      aplicativoTemJob(aplicativo.jobs, CHAVES_JOB.AUDITORIA_ESTOQUE_REFERENCIAS));
    const resultados = [];
    for (const { aplicativoId, aplicativo } of habilitados) {
      try {
        if (!aplicativoTemJob(aplicativo.jobs, CHAVES_JOB.NOTIFICAR)) {
          throw new Error("Habilite NOTIFICAR para enviar a auditoria pela fila.");
        }
        normalizarDestinatariosWhatsapp(aplicativo.whatsapp);
        const grupos = await auditarEstoqueReferencias(aplicativoId, {
          listar: (id, filtros) => listarProdutosOlistApi(id, { ...filtros, validarContrato: true }),
          obterEstoque: obterEstoqueProdutoOlistApi,
        }, limiteEm);
        const executadoEm = new Date();
        const mensagens = criarMensagensAuditoria(grupos, executadoEm);
        const dados = prepararNotificationsAuditoria({ aplicativoId, whatsapp: aplicativo.whatsapp, mensagens, executadoEm });
        const enfileiradas = dados.length
          ? (await prisma.notification.createMany({ data: dados, skipDuplicates: true })).count : 0;
        const resultado = { aplicativoId, ok: true, referencias: grupos.length, partes: mensagens.length, enfileiradas };
        console.info("[auditoria-estoque-referencias] Auditoria concluída.", resultado);
        resultados.push(resultado);
      } catch (error) {
        // Não serializar erros HTTP: podem conter headers OAuth e dados do cliente.
        const diagnostico = error instanceof ErroEtapaAuditoria
          ? { ...error.contexto, ...error.diagnostico }
          : diagnosticarErroAuditoria(error);
        console.error("[auditoria-estoque-referencias] Auditoria incompleta.", { aplicativoId, ...diagnostico });
        const configuracao = error instanceof Error && error.message.startsWith("Habilite NOTIFICAR");
        resultados.push({ aplicativoId, ok: false, diagnostico, erro: configuracao ? error.message : "Auditoria incompleta; nenhum saldo parcial foi enfileirado. Verifique a integração, as permissões e o WhatsApp configurado." });
      }
    }
    const ok = resultados.every((resultado) => resultado.ok);
    return NextResponse.json({ ok, resultados }, { status: ok ? 200 : 500 });
  } catch {
    return NextResponse.json({ ok: false, error: "Falha ao carregar aplicativos da auditoria." }, { status: 500 });
  }
}
