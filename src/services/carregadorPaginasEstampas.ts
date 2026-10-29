import type { ResultadoPesquisaEstampasCatalogo } from "@/services/pesquisarEstampasCatalogoService";

type PaginaEmCache = {
  controller: AbortController;
  promessa: Promise<ResultadoPesquisaEstampasCatalogo>;
  expiraEm: number;
  resultado?: ResultadoPesquisaEstampasCatalogo;
};

// Cache local à tela e à sessão. Compartilha inclusive o prefetch em andamento.
export function criarCarregadorPaginasEstampas(
  token: string,
  requisitar: typeof fetch = fetch,
  agora: () => number = Date.now,
) {
  const paginas = new Map<string, PaginaEmCache>();
  let escopo: string | null = null;

  function limpar() {
    for (const entrada of paginas.values()) entrada.controller.abort();
    paginas.clear();
    escopo = null;
  }

  function carregar(parametros: URLSearchParams): Promise<ResultadoPesquisaEstampasCatalogo> {
    const filtros = new URLSearchParams(parametros);
    filtros.delete("pagina");
    const novoEscopo = filtros.toString();
    if (escopo !== novoEscopo) {
      limpar();
      escopo = novoEscopo;
    }
    const chave = parametros.toString();
    const existente = paginas.get(chave);
    if (existente && existente.expiraEm > agora()) return existente.promessa;
    existente?.controller.abort();
    paginas.delete(chave);
    // Mantém no máximo a página atual e algumas páginas próximas.
    while (paginas.size >= 3) {
      const primeira = paginas.keys().next().value!;
      paginas.get(primeira)?.controller.abort();
      paginas.delete(primeira);
    }
    const controller = new AbortController();
    const entrada: PaginaEmCache = {
      controller,
      expiraEm: Infinity,
      promessa: Promise.resolve().then(async () => {
        if (controller.signal.aborted) throw new DOMException("Pesquisa cancelada", "AbortError");
        const resposta = await requisitar(`/api/estampas/pesquisa?${chave}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const dados = await resposta.json();
        if (!resposta.ok) throw new Error(dados.error ?? "Erro ao pesquisar estampas.");
        if (controller.signal.aborted) throw new DOMException("Pesquisa cancelada", "AbortError");
        entrada.expiraEm = agora() + 60_000;
        entrada.resultado = dados as ResultadoPesquisaEstampasCatalogo;
        return entrada.resultado;
      }).catch((erro: unknown) => {
        if (paginas.get(chave) === entrada) paginas.delete(chave);
        throw erro;
      }),
    };
    paginas.set(chave, entrada);
    return entrada.promessa;
  }

  function obterPronta(parametros: URLSearchParams) {
    const entrada = paginas.get(parametros.toString());
    return entrada && !entrada.controller.signal.aborted && entrada.expiraEm > agora()
      ? entrada.resultado ?? null
      : null;
  }

  return { carregar, limpar, obterPronta };
}
