import React from "react";
import { createRoot } from "react-dom/client";
import { AnotarSkuClient } from "../../src/components/anotar-sku-client";
import type { TrabalhoIaResumo } from "../../src/lib/trabalhos-ia/contrato";

const busca = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
let job: TrabalhoIaResumo | null = null, configuracao = "Sedinha = Fourway; Oxford = Oxford; Tricoline = Tricoline", revisao = 0;
let gerar = 0, consultas = 0, leituras = 0, erroConfig = true;
const originalTimer = window.setTimeout.bind(window);
window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => originalTimer(handler, ms === 10000 ? 80 : ms, ...args)) as typeof window.setTimeout;
Object.assign(window, { iaTeste: {
  get gerar() { return gerar; }, get consultas() { return consultas; }, get leituras() { return leituras; }, get config() { return configuracao; },
  revisar() { if (job) { job.status = "PROCESSANDO"; job.fase = "REVISAR"; job.total = 55; } },
  concluir() { if (job) { job.status = "CONCLUIDO"; job.processados = 55; job.finalizadoEm = new Date().toISOString(); } },
  falhar() { if (job) { job.status = "FALHOU"; job.erro = "Resposta precisa de nova tentativa."; } },
} });
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), "https://erp.test"); const method = init?.method ?? "GET";
  const json = (data: unknown, status = 200) => Response.json(data, { status });
  if (url.pathname.endsWith("/configuracao-ia")) {
    if (method === "PUT") {
      if (erroConfig) { erroConfig = false; return json({ error: "Falha temporária ao salvar." }, 503); }
      const body = JSON.parse(String(init?.body)); configuracao = body.prompt; revisao++; return json({ prompt: configuracao, revisao });
    }
    return json({ prompt: configuracao, revisao, geracao: "Preserve os SKUs e as quantidades.", revisaoFixa: "Revise o resultado antes de publicar." });
  }
  if (url.pathname === "/api/olist/anotar-sku/jobs") return json({ jobs: [], emAberto: false, habilitado: true });
  if (url.pathname === "/api/olist/anotar-sku") return json({ buscas: [{ id: busca, situacoes: ["0", "1"], quantidadePedidos: 21, quantidadeSkus: 55, createdAt: "2026-11-18T18:39:00Z", periodoInicio: "2026-11-04", periodoFim: "2026-11-18", pedidosForaPeriodo: 0 }] });
  if (url.pathname === "/api/trabalhos-ia") { consultas++; return json({ trabalhos: job ? [job] : [] }); }
  if (url.pathname === `/api/trabalhos-ia/${id}`) {
    const acao = JSON.parse(String(init?.body)).acao; if (job) { job.status = acao === "retomar" ? "PENDENTE" : "CANCELADO"; job.erro = null; } return json({ ok: true });
  }
  if (url.pathname.endsWith("/relatorio-ia")) {
    if (method === "POST") {
      gerar++; job = { id, tipo: "anotar_sku.relatorio.v1", origemId: busca, criadoEm: new Date().toISOString(), finalizadoEm: null, status: "PENDENTE", fase: "PREPARAR", total: 0, processados: 0, erro: null, revisaoConfig: revisao };
      await new Promise(resolve => originalTimer(resolve, 80)); return json({ trabalho: job }, 202);
    }
    leituras++;
    if (url.searchParams.has("formato")) return new Response("SKU;PRODUTO;TECIDO;QTD");
    const offset = Number(url.searchParams.get("offset") ?? 0), quantidade = Math.min(50, 55-offset);
    return json({ id, total: 55, revisaoConfig: revisao, finalizadoEm: new Date().toISOString(), proximaPagina: offset === 0 ? 50 : null,
      itens: Array.from({ length: quantidade }, (_, i) => ({ sku: `KIT2-LENCOS-${String(offset+i).padStart(3,"0")}`, produto: "Kit 2 Lenços Estampas Católicas 70x70cm com título longo para testar a leitura", tecido: i % 2 ? "NÃO IDENTIFICADO" : "Fourway", quantidade: 100-offset-i })) });
  }
  return json({ error: "Recurso não previsto no teste" }, 404);
}) as typeof fetch;
const somenteLeitura = new URLSearchParams(location.search).has("leitura");
createRoot(document.getElementById("root")!).render(<main className="mx-auto max-w-7xl p-4 md:p-8"><AnotarSkuClient token="teste" escopo="teste:usuario" podeVisualizar podeEscrever={!somenteLeitura} podeConfigurar={!somenteLeitura} /></main>);
