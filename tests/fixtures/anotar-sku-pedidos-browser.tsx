import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AnotarSkuClient } from "../../src/components/anotar-sku-client";
import { periodoPadraoSku } from "../../src/lib/anotar-sku/periodo";
import type { JobSkuResumo } from "../../src/lib/anotar-sku/contrato";

// Fixture para inspeção no navegador: componentes e CSS reais, sem acesso à Olist.
// ?cenario=falha falha na primeira tentativa de cada página; lento/vazio cobrem os demais estados.
const parametros = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", parametros.get("tema") === "escuro");
const id = "11111111-1111-4111-8111-111111111111";
const sku = "BANDEIRA-OXFORD-PA451-120X90-D";
const itens = [{ sku, tituloProduto: "Bandeira Alemanha Tecido Oxford — produto com título longo para conferir a leitura no celular", quantidade: 105 },
  { sku: "LENCO/90 & 90+A", tituloProduto: "Lenço estampado", quantidade: 3 }];
const soAlertas = parametros.get("cenario") === "so-alertas";
const busca = { id, situacoes: ["0"], quantidadePedidos: soAlertas ? 0 : 54, quantidadeSkus: soAlertas ? 0 : 2, createdAt: "2026-11-17T20:02:00Z", ...periodoPadraoSku(), pedidosForaPeriodo: 53 };
let job: JobSkuResumo | null = null;
const salvo = sessionStorage.getItem("sku-job-fixture");
if (parametros.get("editar") && salvo) job = JSON.parse(salvo);
const tentativas = new Map<string, number>();
const contador = document.createElement("p");
contador.setAttribute("aria-label", "Requisições de pedidos");
contador.style.cssText = "padding: 8px 16px; font-size: 12px";
document.body.prepend(contador);
let chamadas = 0, abortadas = 0;
const atualizarContador = () => { contador.textContent = `Requisições de pedidos: ${chamadas} · Abortadas: ${abortadas}`; };
atualizarContador();
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (url.origin !== location.origin) throw new Error("Requisição não permitida na fixture");
  if (new Headers(init?.headers).get("Authorization") !== "Bearer teste-local") throw new Error("Sessão ausente na consulta");
  if (url.pathname.endsWith("/jobs")) {
    if (init?.method === "POST" && typeof init.body === "string") {
      const entrada = JSON.parse(init.body);
      job = { id: "22222222-2222-4222-8222-222222222222", situacoes: entrada.situacoes, periodoInicio: entrada.periodoInicio, periodoFim: entrada.periodoFim, foraPeriodo: 53,
        status: "PENDENTE", etapa: "LISTAGEM", passagem: 0, encontrados: 107, processados: 53, ignorados: 0, tentativas: 0, proximaTentativaEm: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), finalizadoEm: null, erro: null, buscaId: null, resultadoRemovido: false, podeGerenciar: true };
      sessionStorage.setItem("sku-job-fixture", JSON.stringify(job));
      return Response.json({ job }, { status: 202 });
    }
    return Response.json({ jobs: job ? [job] : [], emAberto: Boolean(job), habilitado: true });
  }
  if (init?.method && init.method !== "GET") throw new Error("Mutação não prevista na fixture");
  if (url.pathname.endsWith("/pedidos") || url.pathname.endsWith("/fora-periodo")) {
    chamadas++; atualizarContador();
    await new Promise<void>((resolve, reject) => {
      const abortar = () => { clearTimeout(timer); abortadas++; atualizarContador(); reject(new DOMException("Abortado", "AbortError")); };
      const timer = setTimeout(() => { init?.signal?.removeEventListener("abort", abortar); resolve(); }, parametros.get("cenario") === "lento" ? 5000 : 250);
      if (init?.signal?.aborted) abortar(); else init?.signal?.addEventListener("abort", abortar, { once: true });
    });
    const chave = url.pathname + url.search;
    const tentativa = (tentativas.get(chave) ?? 0) + 1; tentativas.set(chave, tentativa);
    if (parametros.get("cenario") === "falha" && tentativa === 1) return Response.json({ error: "Falha simulada" }, { status: 503 });
    if (parametros.get("cenario") === "vazio") return Response.json({ pedidos: [], proximoCursor: null });
    const pedidos = url.pathname.endsWith("/fora-periodo")
      ? Array.from({ length: 53 }, (_, i) => ({ id: String(610000 + i), dataCriacao: "2026-10-01" }))
      : url.searchParams.get("sku") === sku
      ? Array.from({ length: 53 }, (_, i) => ({ id: String(710000 + i), quantidade: i % 3 + 1 }))
      : [{ id: "90071992547409931234", quantidade: 3 }];
    const cursor = url.searchParams.get("cursor");
    const restantes = pedidos.filter(p => !cursor || p.id > cursor), pagina = restantes.slice(0, 50);
    return Response.json({ pedidos: pagina, proximoCursor: restantes.length > 50 ? pagina.at(-1)!.id : null });
  }
  if (url.pathname === "/api/olist/anotar-sku") return Response.json(url.searchParams.has("id")
    ? { busca: { ...busca, pedidos: soAlertas ? [] : ["710000", "90071992547409931234"], skus: soAlertas ? [] : itens } } : { buscas: [busca] });
  throw new Error(`URL não prevista: ${url.pathname}`);
};

createRoot(document.getElementById("root")!).render(<StrictMode><main style={{ maxWidth: 1400, margin: "auto", padding: 16 }}>
  <AnotarSkuClient token="teste-local" escopo="teste-local" podeEscrever={parametros.get("editar") === "1"} podeVisualizar />
</main></StrictMode>);
