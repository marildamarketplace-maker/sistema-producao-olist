import { useState } from "react";
import { createRoot } from "react-dom/client";
import { EnviarPedidoFilaOlist } from "../../src/components/enviar-pedido-fila-olist";
import type { PedidoFilaAdministracao } from "../../src/lib/fila-fornecedor-contrato";

declare global {
  interface Window {
    testeVendedorFila: { trocarToken: () => void; leituras: number; fechado: boolean; previas: unknown[] };
  }
}
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const pedido: PedidoFilaAdministracao = {
  id: id(10), solicitacaoProducaoId: id(11), status: "PENDENTE", origem: "Loja",
  filial: { id: id(3), nome: "Conta destinatária com nome longo para validar quebra" },
  createdAt: "2026-11-24T00:00:00.000Z", direcionadoEm: null, versao: 0,
  dadosPedido: { versao: 1, itens: [{ produtoId: id(12), sku: "SKU", tecido: { id: id(13), nome: "Oxford", referencia: null }, quantidade: 1, unidade: "UN", quantidadeTecido: 2, unidadeTecido: "MT", estampa: "A", variante: null, corteLaser: false, tamanho: "", tipoProduto: "" }] },
};
window.testeVendedorFila = { trocarToken: () => undefined, leituras: 0, fechado: false, previas: [] };
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
  if (init?.method === "POST") {
    window.testeVendedorFila.previas.push(JSON.parse(String(init.body)) as unknown);
    return Response.json({ error: "Prévia interceptada para conferir as seleções enviadas." }, { status: 400 });
  }
  if (url.searchParams.get("recurso") === "vendedores") {
    return Response.json({ itens: [{ id: 200, nome: "Vendedor padrão" }, { id: 300, nome: "Outro vendedor" }], pagina: 1, mais: false });
  }
  if (url.searchParams.get("recurso") === "clientes") {
    return Response.json({ itens: [{ id: 100, nome: "Cliente inicial" }, { id: 101, nome: "Cliente escolhido manualmente" }], pagina: 1, mais: false });
  }
  window.testeVendedorFila.leituras++;
  const vinculado = new URLSearchParams(location.search).get("vinculado") === "1";
  return Response.json({ filial: pedido.filial, vendedorOlistPadraoId: 200, envio: null,
    vendedorFixo: vinculado, vendedorOrigem: vinculado ? { tipo: "VINCULO", usuarioId: id(20), aplicativoSolicitanteId: id(21), matrizId: id(22), aplicativoId: pedido.filial?.id, vendedorOlistId: 200, revisao: 1 } : null,
    selecoes: vinculado ? { vendedorId: 200, clienteId: 100 } : new URLSearchParams(location.search).get("salvo") === "1" ? { vendedorId: 300 } : null });
};
document.documentElement.classList.toggle("dark", new URLSearchParams(location.search).get("tema") === "dark");
function App() {
  const [token, setToken] = useState(0);
  const [aberto, setAberto] = useState(false);
  window.testeVendedorFila.trocarToken = () => setToken((atual) => atual + 1);
  return <main className="p-4"><button id="abrir" className="min-h-11 rounded-md border px-4 py-2" onClick={() => setAberto(true)}>Abrir pedido</button>{aberto && <EnviarPedidoFilaOlist pedido={pedido} token={`token-${token}`} aoFechar={() => { window.testeVendedorFila.fechado = true; setAberto(false); }} aoConcluir={() => undefined} />}</main>;
}
createRoot(document.getElementById("root")!).render(<App />);
