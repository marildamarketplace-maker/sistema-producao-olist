import { useState } from "react";
import { createRoot } from "react-dom/client";
import { EnviarPedidoFilaOlist } from "../../src/components/enviar-pedido-fila-olist";
import type { PedidoFilaAdministracao } from "../../src/lib/fila-fornecedor-contrato";
import type { SelecoesFilaOlistParciais } from "../../src/lib/fila-olist-contrato";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const params = new URLSearchParams(location.search);
const keys = ["vendedorId", "clienteId", "formaId", `tecido:${id(13)}`, "planoId"];
let versao = 2;
let selecoes: SelecoesFilaOlistParciais = {};
const campos: Array<{ chave: string; estado: "RECUPERADO" | "PENDENTE"; mensagem: string }> = [];
declare global { interface Window { recuperacaoTeste: { chamadas: string[]; previas: unknown[]; token: () => void; liberar: () => void }; } }
window.recuperacaoTeste = { chamadas: [], previas: [], token: () => undefined, liberar: () => undefined };
const pedido: PedidoFilaAdministracao = {
  id: id(10), solicitacaoProducaoId: id(11), status: "PENDENTE", origem: "Loja", filial: { id: id(3), nome: "Novo aplicativo destinatário" },
  createdAt: "2026-11-24T00:00:00.000Z", direcionadoEm: null, versao: 2,
  dadosPedido: { versao: 1, olist: { filialId: id(2), selecoes: { recursoForma: "RECEBIMENTO" as const, clienteId: 1, vendedorId: 2, formaId: 3, tecidos: [{ tecidoId: id(13), id: 4, preco: 9 }] } },
    itens: [{ produtoId: id(12), sku: "SKU", tecido: { id: id(13), nome: "Oxford Ref. 001 com nome comprido para testar quebra no celular", referencia: null }, quantidade: 1, unidade: "MT", quantidadeTecido: 2, unidadeTecido: "MT", estampa: "", variante: null, corteLaser: false, tamanho: "", tipoProduto: "" }] },
};
const recuperacao = () => ({ campos, restantes: keys.filter(k => !campos.some(c => c.chave === k)) });
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
  if (init?.method === "POST") {
    const body = JSON.parse(String(init.body));
    if (body.acao !== "recuperar") { window.recuperacaoTeste.previas.push(body); return Response.json({ error: "Prévia interceptada" }, { status: 400 }); }
    window.recuperacaoTeste.chamadas.push(body.chave);
    if (params.has("pausar") && body.chave === "clienteId") await new Promise<void>(resolve => { window.recuperacaoTeste.liberar = resolve; });
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (body.versao !== versao) return Response.json({ error: "Versão antiga" }, { status: 409 });
    const pendente = params.has("parcial") && body.chave === "clienteId";
    campos.splice(0, campos.length, ...campos.filter(c => c.chave !== body.chave), { chave: body.chave, estado: pendente ? "PENDENTE" : "RECUPERADO", mensagem: pendente ? "Mais de uma correspondência. Selecione o cliente correto." : "Recuperado." });
    selecoes = { ...selecoes, tipoVenda: "VENDA", ...(body.chave === "vendedorId" ? { recursoForma: "RECEBIMENTO" as const, vendedorId: 120 } : body.chave === "clienteId" && !pendente ? { recursoForma: "RECEBIMENTO" as const, clienteId: 130 } : body.chave === "formaId" ? { recursoForma: "RECEBIMENTO" as const, formaId: 140 } : body.chave.startsWith("tecido:") ? { tecidos: [{ tecidoId: id(13), id: 150, preco: 21.99 }] } : body.chave === "planoId" ? { planoId: id(30) } : {}) };
    versao++;
    return Response.json({ versao, filialId: id(3), alteracoes: selecoes, campo: campos.find(c => c.chave === body.chave) });
  }
  if (url.searchParams.get("recurso") === "clientes") return Response.json({ itens: [{ id: 130, nome: "Cliente escolhido" }, { id: 131, nome: "Outro cliente" }], mais: false, pagina: 1 });
  if (url.searchParams.get("recurso") === "planos") return Response.json({ itens: [{ id: id(30), nome: "30/60" }] });
  if (url.searchParams.has("recurso")) return Response.json({ itens: [], mais: false, pagina: 1 });
  return Response.json({ filial: pedido.filial, versao, selecoes, recuperacao: recuperacao(), vendedorFixo: false, vendedorOrigem: { tipo: "MANUAL" }, envio: null });
};
document.documentElement.classList.toggle("dark", params.get("tema") === "dark");
function App() {
  const [aberto, setAberto] = useState(false), [token, setToken] = useState(0);
  window.recuperacaoTeste.token = () => setToken(v => v + 1);
  return <main className="p-4"><button id="abrir" onClick={() => setAberto(true)}>Abrir</button>{aberto && <EnviarPedidoFilaOlist pedido={pedido} token={`token-${token}`} aoFechar={() => setAberto(false)} aoConcluir={() => undefined} />}</main>;
}
createRoot(document.getElementById("root")!).render(<App />);
