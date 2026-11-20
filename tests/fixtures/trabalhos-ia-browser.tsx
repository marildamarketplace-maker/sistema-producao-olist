import React from "react";
import { createRoot } from "react-dom/client";
import { AnotarSkuClient } from "../../src/components/anotar-sku-client";
import type { TrabalhoIaResumo } from "../../src/lib/trabalhos-ia/contrato";
import type { JobSkuResumo } from "../../src/lib/anotar-sku/contrato";
import { ordenarSkus, type ColunaOrdenacaoSku } from "../../src/lib/anotar-sku/ordenacao";

const busca = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
let job: TrabalhoIaResumo | null = null, configuracao = "Sedinha = Fourway; Oxford = Oxford; Tricoline = Tricoline", revisao = 0;
let gerar = 0, consultas = 0, leituras = 0, erroConfig = true, gerarAutomaticamente = false;
const downloads: string[] = [];
let erroDownload = false;
let erroLeitura = false, leiturasSkus = 0;
const consultasRelatorio: string[] = [];
let buscaJob: JobSkuResumo = { id: "33333333-3333-4333-8333-333333333333", buscaId: busca, status: "CONCLUIDO", etapa: "CONSOLIDACAO", situacoes: ["0", "1"], passagem: 1, encontrados: 37, processados: 37, ignorados: 0, foraPeriodo: 16, tentativas: 1, erro: null, proximaTentativaEm: "2026-11-18T18:39:00Z", createdAt: "2026-11-18T18:38:00Z", updatedAt: "2026-11-18T18:39:00Z", periodoInicio: "2026-11-04", periodoFim: "2026-11-18", podeGerenciar: true, resultadoRemovido: false, finalizadoEm: "2026-11-18T18:39:00Z" };
const originalTimer = window.setTimeout.bind(window);
window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => originalTimer(handler, ms === 10000 ? 80 : ms, ...args)) as typeof window.setTimeout;
Object.assign(window, { iaTeste: {
  get gerar() { return gerar; }, get consultas() { return consultas; }, get leituras() { return leituras; }, get config() { return configuracao; }, get downloads() { return downloads; }, get automatico() { return gerarAutomaticamente; },
  falharDownload() { erroDownload = true; },
  get leiturasSkus() { return leiturasSkus; }, get consultasRelatorio() { return consultasRelatorio; },
  falharLeitura() { erroLeitura = true; },
  estadoBusca(status: JobSkuResumo["status"], semResultado = false) { buscaJob = { ...buscaJob, status, buscaId: semResultado ? null : busca, erro: status === "FALHOU" ? "Falha temporária na busca." : null }; },
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
      const body = JSON.parse(String(init?.body)); configuracao = body.prompt; gerarAutomaticamente = body.gerarAutomaticamente; revisao++; return json({ prompt: configuracao, revisao, gerarAutomaticamente });
    }
    return json({ prompt: configuracao, revisao, gerarAutomaticamente, geracao: "Preserve os SKUs e as quantidades.", revisaoFixa: "Revise o resultado antes de publicar." });
  }
  if (url.pathname === "/api/olist/anotar-sku/jobs") return json({ jobs: [buscaJob], emAberto: ["PENDENTE", "PROCESSANDO", "AGUARDANDO_RETRY", "FALHOU"].includes(buscaJob.status), habilitado: true });
  if (url.pathname === "/api/olist/anotar-sku") {
    const salvo = { id: busca, situacoes: ["0", "1", "3", "4"], quantidadePedidos: 21, quantidadeSkus: 55, createdAt: "2026-11-18T18:39:00Z", periodoInicio: "2026-11-04", periodoFim: "2026-11-18", pedidosForaPeriodo: 16 };
    if (url.searchParams.has("formato")) {
      downloads.push(url.searchParams.get("formato")!);
      if (erroDownload) { erroDownload = false; return json({ error: "Falha temporária no download." }, 503); }
      return new Response("SKU;QTD");
    }
    if (url.searchParams.has("id")) { leiturasSkus++; return json({ busca: { ...salvo, pedidos: ["123"], skus: [
      { sku: "SKU10", tituloProduto: "Bandeira Oxford", quantidade: 2 },
      { sku: "SKU2", tituloProduto: "Lenço Sedinha", quantidade: 20 },
      { sku: "SKU1", tituloProduto: "Tricoline Natal", quantidade: 10 },
    ] } }); }
    return json({ buscas: [salvo] });
  }
  if (url.pathname === "/api/trabalhos-ia") { consultas++; return json({ trabalhos: job ? [job] : [] }); }
  if (url.pathname.endsWith("/pedidos")) return json({ pedidos: [{ id: "123", quantidade: 20 }], proximoCursor: null });
  if (url.pathname === `/api/trabalhos-ia/${id}`) {
    const acao = JSON.parse(String(init?.body)).acao; if (job) { job.status = acao === "retomar" ? "PENDENTE" : "CANCELADO"; job.erro = null; } return json({ ok: true });
  }
  if (url.pathname.endsWith("/relatorio-ia")) {
    if (method === "POST") {
      gerar++; job = { id, tipo: "anotar_sku.relatorio.v1", origemId: busca, criadoEm: new Date().toISOString(), finalizadoEm: null, status: "PENDENTE", fase: "PREPARAR", total: 0, processados: 0, erro: null, revisaoConfig: revisao };
      await new Promise(resolve => originalTimer(resolve, 80)); return json({ trabalho: job }, 202);
    }
    leituras++;
    if (url.searchParams.has("formato")) { downloads.push(`ia:${url.searchParams.get("formato")}`); return new Response("SKU;PRODUTO;TECIDO;QTD"); }
    consultasRelatorio.push(url.search);
    if (erroLeitura) { erroLeitura = false; return json({ error: "Falha temporária na leitura." }, 503); }
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const itens = Array.from({ length: 55 }, (_, i) => ({ sku: `KIT2-LENCOS-${String(i).padStart(3,"0")}`, produto: `${String(55-i).padStart(3,"0")} Kit 2 Lenços Estampas Católicas 70x70cm com título longo para testar a leitura`, tecido: i % 2 ? "NÃO IDENTIFICADO" : "Fourway", quantidade: 100-i }));
    const ordenados = ordenarSkus(itens, { coluna: (url.searchParams.get("ordenarPor") ?? "quantidade") as ColunaOrdenacaoSku, direcao: url.searchParams.get("direcao") === "asc" ? "asc" : "desc" });
    return json({ id, total: 55, revisaoConfig: revisao, finalizadoEm: new Date().toISOString(), proximaPagina: offset === 0 ? 50 : null,
      itens: ordenados.slice(offset, offset+50) });
  }
  return json({ error: "Recurso não previsto no teste" }, 404);
}) as typeof fetch;
const somenteLeitura = new URLSearchParams(location.search).has("leitura");
createRoot(document.getElementById("root")!).render(<div className="flex min-h-screen"><aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-white p-6 md:flex md:flex-col" aria-label="Navegação de teste"><p className="font-semibold">Meury Shop</p><p className="mt-6 text-sm">Anotar SKU</p></aside><main className="min-w-0 flex-1 p-4 sm:p-6 md:p-8"><AnotarSkuClient token="teste" escopo="teste:usuario" podeVisualizar podeEscrever={!somenteLeitura} podeConfigurar={!somenteLeitura} /></main></div>);
