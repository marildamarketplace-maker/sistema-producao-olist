import axios from "axios";
import { FalhaPedidosSemEnvio, interpretarPaginaSemEnvio, LIMITE_PAGINA_SEM_ENVIO } from "./pedidos-sem-envio";

type Dependencias = {
  configurar(id: string): Promise<{ apiBaseUrl: string }>;
  token(id: string, opcoes?: { tokenRejeitado: string }): Promise<string>;
  http(url: string, token: string): Promise<{ status: number; data: unknown; retryAfter?: unknown }>;
};
const padrao: Dependencias = {
  async configurar(id) { return (await import("@/lib/aplicativo")).getAplicativoOlistConfig(id); },
  async token(id, opcoes) { return (await import("@/lib/olist")).getValidOlistAccessToken(id, opcoes); },
  async http(url, token) {
    const r = await axios.get<unknown>(url, {
      headers: { Authorization: `Bearer ${token}` }, timeout: 20_000, signal: AbortSignal.timeout(20_000),
      maxRedirects: 0, maxContentLength: 2 * 1024 * 1024, validateStatus: () => true,
    });
    return { status: r.status, data: r.data, retryAfter: r.headers["retry-after"] };
  },
};
export function criarClientePedidosSemEnvio(deps: Dependencias = padrao) {
  return {
    async listar(aplicativoId: string, situacao: number, offset: number, dataFinal: string) {
      if (![1, 7].includes(situacao) || !Number.isSafeInteger(offset) || offset < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(dataFinal)) {
        throw new FalhaPedidosSemEnvio("FILTRO_INVALIDO");
      }
      try {
        const config = await deps.configurar(aplicativoId);
        const url = new URL("pedidos", config.apiBaseUrl.replace(/\/?$/, "/"));
        for (const [k, v] of Object.entries({ situacao, offset, limit: LIMITE_PAGINA_SEM_ENVIO, orderBy: "asc", dataFinal })) url.searchParams.set(k, String(v));
        const token = await deps.token(aplicativoId);
        let resposta = await deps.http(url.toString(), token);
        if (resposta.status === 401) resposta = await deps.http(url.toString(), await deps.token(aplicativoId, { tokenRejeitado: token }));
        if (resposta.status < 200 || resposta.status >= 300) {
          const valor = resposta.retryAfter;
          const tempo = typeof valor === "string" || typeof valor === "number"
            ? Number.isFinite(Number(valor)) ? Number(valor) * 1000 : Date.parse(String(valor)) - Date.now() : 0;
          const retryAfter = Number.isFinite(tempo) ? Math.max(0, Math.min(tempo, 86_400_000)) : 0;
          throw new FalhaPedidosSemEnvio(`OLIST_${resposta.status}`, [408, 429].includes(resposta.status) || resposta.status >= 500, retryAfter);
        }
        const pagina = interpretarPaginaSemEnvio(resposta.data);
        if (!pagina.pedidos.length && pagina.total > offset) throw new FalhaPedidosSemEnvio("PAGINACAO_INVALIDA");
        return pagina;
      } catch (erro) {
        if (erro instanceof FalhaPedidosSemEnvio) throw erro;
        if (axios.isAxiosError(erro)) throw new FalhaPedidosSemEnvio("REDE", true);
        throw new FalhaPedidosSemEnvio("INTEGRACAO");
      }
    },
  };
}
