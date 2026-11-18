import React from "react";
import { createRoot } from "react-dom/client";
import { FilaPedidosFornecedorClient } from "../../src/components/fila-pedidos-fornecedor-client";

const pedido = { id: "00000000-0000-0000-0000-000000000010", solicitacaoProducaoId: "00000000-0000-0000-0000-000000000011", status: "PENDENTE", versao: 0,
  origem: "Empresa solicitante com nome longo para conferir quebra de texto", createdAt: "2026-11-17T12:00:00Z", filial: null, direcionadoEm: null, dadosPedido: null };
const estado = { falhar: false, chamadas: [] as Record<string, unknown>[], status: "PENDENTE" };
Object.assign(window, { filaCancelamentoTeste: estado });
window.fetch = async (_input, init) => {
  if (init?.method === "POST") {
    const body = JSON.parse(String(init.body)); estado.chamadas.push(body);
    if (estado.falhar) return Response.json({ error: "Pedido alterado. Atualize a fila antes de cancelar." }, { status: 409 });
    estado.status = "CANCELADO"; return Response.json({ id: pedido.id, status: "CANCELADO", versao: 1 });
  }
  return Response.json({ pedidos: [{ ...pedido, status: estado.status, versao: estado.status === "CANCELADO" ? 1 : 0 }], filiais: [], total: 1, pagina: 1, porPagina: 20 });
};
createRoot(document.getElementById("root")!).render(<FilaPedidosFornecedorClient token="teste-local" />);
