import axios from "axios";
import { getAplicativoOlistConfig } from "@/lib/aplicativo";
import { getValidOlistAccessToken } from "@/lib/olist";
import { agregarItensSku, FalhaConsultaSku } from "./contrato";

export function retryAfterSku(valor: unknown, agora = Date.now()) {
  if (typeof valor !== "string" && typeof valor !== "number") return 0;
  const segundos = Number(valor);
  const ms = Number.isFinite(segundos) ? segundos * 1000 : Date.parse(String(valor)) - agora;
  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

// Uma operação de fila faz no máximo uma renovação OAuth e duas chamadas HTTP.
// A política de repetição transitória pertence à fila, não a este cliente.
async function consultar(aplicativoId: string, caminho: string, parametros?: Record<string, string>) {
  try {
    const config = await getAplicativoOlistConfig(aplicativoId);
    const url = new URL(caminho, config.apiBaseUrl.endsWith("/") ? config.apiBaseUrl : `${config.apiBaseUrl}/`);
    for (const [chave, valor] of Object.entries(parametros ?? {})) url.searchParams.set(chave, valor);
    const executar = (token: string) => axios.get<unknown>(url.toString(), {
      headers: { Authorization: `Bearer ${token}` }, timeout: 20_000,
      signal: AbortSignal.timeout(20_000), validateStatus: () => true,
    });
    const token = await getValidOlistAccessToken(aplicativoId);
    let resposta = await executar(token);
    if (resposta.status === 401) {
      resposta = await executar(await getValidOlistAccessToken(aplicativoId, { tokenRejeitado: token }));
    }
    if (resposta.status < 200 || resposta.status >= 300) {
      const temporaria = resposta.status === 429 || resposta.status === 408 || resposta.status >= 500;
      const mensagem = resposta.status === 401 || resposta.status === 403
        ? "Reconecte a integração Olist e tente novamente."
        : temporaria ? "A Olist está temporariamente indisponível ou limitou as consultas."
          : "Não foi possível consultar o pedido na Olist. Verifique a integração antes de retomar.";
      throw new FalhaConsultaSku(`OLIST_${resposta.status}`, mensagem, temporaria, retryAfterSku(resposta.headers["retry-after"]));
    }
    return resposta.data;
  } catch (erro) {
    if (erro instanceof FalhaConsultaSku) throw erro;
    if (axios.isAxiosError(erro)) throw new FalhaConsultaSku("REDE", "A conexão com a Olist foi interrompida. Uma nova tentativa será feita.", true);
    if (erro instanceof Error && (erro.message === "Falha no OAuth Olist/Tiny." ||
      ("requerReconexao" in erro && erro.requerReconexao === true))) {
      throw new FalhaConsultaSku("CONEXAO_OLIST", "Reconecte a integração Olist e tente novamente.", false);
    }
    throw erro;
  }
}

export function interpretarPaginaSku(payload: unknown): string[] {
  const objeto = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const lista = Array.isArray(payload) ? payload : objeto.itens ?? objeto.data ?? objeto.orders ?? objeto.results ?? objeto.pedidos;
  if (!Array.isArray(lista) || lista.length > 100) throw new FalhaConsultaSku("CONTRATO", "A listagem da Olist veio em um formato inesperado.", false);
  return lista.map(item => {
    const id = item && typeof item === "object" ? String(item.id ?? "") : "";
    if (!/^\d+$/.test(id) || (typeof item.id === "number" && !Number.isSafeInteger(item.id))) {
      throw new FalhaConsultaSku("CONTRATO", "A Olist retornou um pedido sem identificador válido.", false);
    }
    return id;
  });
}
export const clienteAnotarSku = {
  async listar(aplicativoId: string, situacao: string, offset: number) {
    return interpretarPaginaSku(await consultar(aplicativoId, "pedidos", { situacao, offset: String(offset), limit: "100", orderBy: "asc" }));
  },
  async detalhar(aplicativoId: string, pedidoId: string) {
    const payload = await consultar(aplicativoId, `pedidos/${encodeURIComponent(pedidoId)}`);
    if (!payload || typeof payload !== "object" || !("itens" in payload) || !Array.isArray(payload.itens)) {
      throw new FalhaConsultaSku("CONTRATO", "Os itens do pedido vieram em um formato inesperado.", false);
    }
    return agregarItensSku(payload.itens);
  },
};
