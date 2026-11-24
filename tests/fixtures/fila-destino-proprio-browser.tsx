import { createRoot } from "react-dom/client";
import { FilaPedidosFornecedorClient } from "../../src/components/fila-pedidos-fornecedor-client";
import type { ListaFilaAdministracao, PedidoFilaAdministracao } from "../../src/lib/fila-fornecedor-contrato";

declare global {
  interface Window {
    testeDestinoProprio: { chamadas: Array<{ filialId: string; enviarOlist: boolean }>; leiturasEnvio: number };
  }
}

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const aplicativo = { id: id(2), nome: "Fornecedor independente com nome longo para validar quebra" };
const pedido: PedidoFilaAdministracao = {
  id: id(10), solicitacaoProducaoId: id(11), status: "PENDENTE", versao: 0,
  origem: "Loja solicitante", createdAt: "2026-11-24T00:00:00Z", filial: null, direcionadoEm: null,
  dadosPedido: { versao: 1, itens: [{ produtoId: id(12), sku: "SKU", tecido: { id: id(13), nome: "Oxford", referencia: null },
    quantidade: 1, unidade: "UN", quantidadeTecido: 2, unidadeTecido: "MT", estampa: "A", variante: null, corteLaser: false, tamanho: "", tipoProduto: "" }] },
};
window.testeDestinoProprio = { chamadas: [], leiturasEnvio: 0 };
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
  if (url.pathname.endsWith("/administracao")) {
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as { filialId: string; enviarOlist: boolean };
      window.testeDestinoProprio.chamadas.push(body);
      if (body.filialId !== aplicativo.id) return Response.json({ error: "Conta inválida." }, { status: 400 });
      pedido.filial = aplicativo; pedido.versao++;
      return Response.json({ id: pedido.id, filialId: aplicativo.id, status: "PENDENTE", versao: pedido.versao });
    }
    const resposta: ListaFilaAdministracao = { pedidos: [pedido], filiais: [aplicativo], total: 1, pagina: 1, porPagina: 20 };
    return Response.json(resposta);
  }
  window.testeDestinoProprio.leiturasEnvio++;
  return Response.json({ filial: aplicativo, selecoes: null, vendedorOlistPadraoId: 700, envio: null });
};
document.documentElement.classList.toggle("dark", new URLSearchParams(location.search).get("tema") === "dark");
createRoot(document.getElementById("root")!).render(<main className="p-4"><FilaPedidosFornecedorClient token="teste-local" /></main>);
