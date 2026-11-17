import React from "react";
import { createRoot } from "react-dom/client";
import Page from "../../src/app/olist/sincronizacao/page";
import type { ConfiguracaoSyncDto, ExecucaoSyncDetalheDto, ResumoSyncDto } from "../../src/lib/olist-sync/api-contract";

declare global {
  interface Window {
    olistSyncTeste: { concluir: () => void; chamadas: string[]; detalheFinalRespondido: boolean; detalheFinalAbortado: boolean };
  }
}

// Apenas o relógio de polling é acelerado. A página e seus efeitos React são reais.
const relogio: Window = window;
const timeoutReal = relogio.setTimeout.bind(relogio);
relogio.setTimeout = (handler: TimerHandler, timeout?: number, ...args: unknown[]) => timeoutReal(handler, timeout === 10_000 ? 50 : timeout, ...args);
const empresas = ["00000000-0000-0000-0000-000000000004", "00000000-0000-0000-0000-000000000005"].map((id, index) => ({ id, nome: `Empresa ${index + 1}`, habilitado: true }));
const id = "11111111-1111-4111-8111-111111111111", criadoEm = "2026-11-16T12:00:00Z";
const configuracao: ConfiguracaoSyncDto = {
  id, aplicativoPaiId: "00000000-0000-0000-0000-000000000002", aplicativoPaiNome: "Pai de testes", ativo: true, versao: 1,
  entidades: ["PRODUTO"], participantes: empresas, aplicativosOrigem: empresas, aplicativosElegiveis: empresas,
  horaDiaria: "02:00", fusoHorario: "America/Sao_Paulo", limiteAlteracoes: 100, proximaExecucaoEm: null,
  prontidao: { sincronizacaoNativaCompativel: false, semanticaPutValidada: false, incrementalValidado: false }, jobs: [],
};
const execucao: ExecucaoSyncDetalheDto = {
  id, modo: "AUDITAR", status: "AUDITANDO", origem: "MANUAL", criadoEm, iniciadoEm: criadoEm, finalizadoEm: null,
  contadores: {}, etapas: [],
};
let concluida = false;
window.olistSyncTeste = { concluir: () => { concluida = true; }, chamadas: [], detalheFinalRespondido: false, detalheFinalAbortado: false };

// Não há backend: qualquer URL ou método inesperado falha, impedindo contato externo.
window.fetch = async (input, init) => {
  const recurso = String(input).replace(/^\/api\/olist\/sincronizacao\//, "");
  if (init?.method && init.method !== "GET") throw new Error(`Mutação inesperada no teste: ${init.method}`);
  if (init?.cache !== "no-store" || new Headers(init.headers).get("authorization") !== "Bearer teste-local") throw new Error("Contrato de sessão/cache ausente");
  window.olistSyncTeste.chamadas.push(recurso);
  const atual: ExecucaoSyncDetalheDto = { ...execucao, status: concluida ? "CONCLUIDA" : "AUDITANDO", finalizadoEm: concluida ? "2026-11-16T12:01:00Z" : null };
  if (recurso === "configuracao") return Response.json(configuracao);
  if (recurso === "previsao") return Response.json({ previsao: { execucaoId: id, calculadoEm: "2026-11-17T21:00:00Z",
    janelaInicio: "2026-11-17T20:30:00Z", janelaFim: "2026-11-17T21:00:00Z", validadosNaJanela: 600, restantes: 1000,
    porMinuto: 20, terminoPrevisto: "2026-11-17T21:50:00Z", estado: "ESTIMADA" } });
  if (recurso === "resumo") {
    const resumo: ResumoSyncDto = { sincronizados: 1, divergentes: 0, pendencias: 0, erros: 0, ultimaExecucao: atual, execucaoAtiva: concluida ? null : atual };
    return Response.json(resumo);
  }
  if (recurso === `execucoes/${id}`) {
    if (concluida) {
      await new Promise<void>((resolve, reject) => {
        const aoAbortar = () => {
          clearTimeout(timer); window.olistSyncTeste.detalheFinalAbortado = true;
          reject(new DOMException("Consulta abortada", "AbortError"));
        };
        const timer = timeoutReal(() => {
          init?.signal?.removeEventListener("abort", aoAbortar);
          window.olistSyncTeste.detalheFinalRespondido = true; resolve();
        }, 100);
        if (init?.signal?.aborted) aoAbortar();
        else init?.signal?.addEventListener("abort", aoAbortar, { once: true });
      });
    }
    return Response.json(atual);
  }
  if (recurso.startsWith("execucoes?")) return Response.json({ itens: [atual], total: 1, limit: 25, offset: 0 });
  throw new Error(`URL inesperada no teste: ${recurso}`);
};

createRoot(document.getElementById("root")!).render(<Page />);
