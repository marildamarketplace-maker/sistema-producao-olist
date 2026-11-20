import { setTimeout as esperar } from "node:timers/promises";
import { renovarEnquantoValida } from "@/lib/automatizacao/renovacao";
import { ImageAnalysisProviderError } from "@/services/image-analysis/ImageAnalysisProviderError";
import type { OperacaoIa, TrabalhoWorkerIa } from "./contrato";

type Api = (corpo: OperacaoIa, timeoutMs?: number) => Promise<unknown>;
export async function consumirEtapaIa(opcoes: {
  trabalho: TrabalhoWorkerIa; iniciadaEm: number; signal: AbortSignal; api: Api;
  executar: (trabalho: TrabalhoWorkerIa, signal: AbortSignal) => Promise<unknown>;
}) {
  if (opcoes.signal.aborted) return null;
  const fim = new AbortController();
  const signal = AbortSignal.any([fim.signal, opcoes.signal]);
  const { reserva } = opcoes.trabalho;
  const renovacao = renovarEnquantoValida({
    iniciadaEm: opcoes.iniciadaEm, signal, agora: () => performance.now(),
    esperar: ms => esperar(ms, undefined, { signal }).catch(() => {}),
    renovar: async timeout => {
      const resposta = await opcoes.api({ acao: "renovar", reserva }, timeout);
      return typeof resposta === "object" && resposta !== null && "ok" in resposta && resposta.ok === true;
    },
  }).then(valida => { if (!valida) fim.abort(); });
  try {
    let fechamento: OperacaoIa;
    try {
      const resultado = await opcoes.executar(opcoes.trabalho, signal);
      fechamento = { acao: "finalizar", reserva, resultado };
    } catch (error) {
      const codigo = error instanceof SyntaxError ? "RESPOSTA_INVALIDA"
        : error instanceof ImageAnalysisProviderError && error.code === "AUTHENTICATION_ERROR" ? "AUTENTICACAO"
        : error instanceof ImageAnalysisProviderError && error.code === "CONFIGURATION_ERROR" ? "CONFIGURACAO" : "TEMPORARIA";
      fechamento = { acao: "falhar", reserva, codigo };
    }
    // A mesma reserva pode confirmar duas vezes sem repetir a publicação.
    if (!signal.aborted) return await opcoes.api(fechamento).catch(() => signal.aborted ? null : opcoes.api(fechamento));
    return null;
  } finally { fim.abort(); await renovacao; }
}
