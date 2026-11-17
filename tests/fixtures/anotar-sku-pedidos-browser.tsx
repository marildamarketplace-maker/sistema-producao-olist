import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AnotarSkuClient } from "../../src/components/anotar-sku-client";

// Fixture para inspeção no navegador: componentes e CSS reais, sem acesso à Olist.
// ?cenario=falha falha na primeira tentativa de cada página; lento/vazio cobrem os demais estados.
const parametros = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", parametros.get("tema") === "escuro");
const id = "11111111-1111-4111-8111-111111111111";
const sku = "BANDEIRA-OXFORD-PA451-120X90-D";
const itens = [{ sku, tituloProduto: "Bandeira Alemanha Tecido Oxford — produto com título longo para conferir a leitura no celular", quantidade: 105 },
  { sku: "LENCO/90 & 90+A", tituloProduto: "Lenço estampado", quantidade: 3 }];
const busca = { id, situacoes: ["0"], quantidadePedidos: 54, quantidadeSkus: 2, createdAt: "2026-11-17T20:02:00Z" };
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
  if (url.origin !== location.origin || (init?.method && init.method !== "GET")) throw new Error("Requisição não permitida na fixture");
  if (new Headers(init?.headers).get("Authorization") !== "Bearer teste-local") throw new Error("Sessão ausente na consulta");
  if (url.pathname.endsWith("/jobs")) return Response.json({ jobs: [], emAberto: false, habilitado: true });
  if (url.pathname.endsWith("/pedidos")) {
    chamadas++; atualizarContador();
    await new Promise<void>((resolve, reject) => {
      const abortar = () => { clearTimeout(timer); abortadas++; atualizarContador(); reject(new DOMException("Abortado", "AbortError")); };
      const timer = setTimeout(() => { init?.signal?.removeEventListener("abort", abortar); resolve(); }, parametros.get("cenario") === "lento" ? 5000 : 250);
      if (init?.signal?.aborted) abortar(); else init?.signal?.addEventListener("abort", abortar, { once: true });
    });
    const chave = url.search;
    const tentativa = (tentativas.get(chave) ?? 0) + 1; tentativas.set(chave, tentativa);
    if (parametros.get("cenario") === "falha" && tentativa === 1) return Response.json({ error: "Falha simulada" }, { status: 503 });
    if (parametros.get("cenario") === "vazio") return Response.json({ pedidos: [], proximoCursor: null });
    const pedidos = url.searchParams.get("sku") === sku
      ? Array.from({ length: 53 }, (_, i) => ({ id: String(710000 + i), quantidade: i % 3 + 1 }))
      : [{ id: "90071992547409931234", quantidade: 3 }];
    const cursor = url.searchParams.get("cursor");
    const restantes = pedidos.filter(p => !cursor || p.id > cursor), pagina = restantes.slice(0, 50);
    return Response.json({ pedidos: pagina, proximoCursor: restantes.length > 50 ? pagina.at(-1)!.id : null });
  }
  if (url.pathname === "/api/olist/anotar-sku") return Response.json(url.searchParams.has("id")
    ? { busca: { ...busca, pedidos: ["710000", "90071992547409931234"], skus: itens } } : { buscas: [busca] });
  throw new Error(`URL não prevista: ${url.pathname}`);
};

createRoot(document.getElementById("root")!).render(<StrictMode><main style={{ maxWidth: 1400, margin: "auto", padding: 16 }}>
  <AnotarSkuClient token="teste-local" escopo="teste-local" podeEscrever={false} podeVisualizar />
</main></StrictMode>);
