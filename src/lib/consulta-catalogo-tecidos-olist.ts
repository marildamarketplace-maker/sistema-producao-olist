export const PRAZO_PAGINA_CATALOGO_TECIDOS_MS = 30_000;

/** Limita também respostas cujo transporte não respeite o cancelamento. */
export function consultarPaginaCatalogoTecidosOlist(carregar: (signal: AbortSignal) => Promise<unknown>, signal: AbortSignal,
  prazoMs = PRAZO_PAGINA_CATALOGO_TECIDOS_MS): Promise<unknown> {
  if (!Number.isInteger(prazoMs) || prazoMs < 1 || prazoMs > PRAZO_PAGINA_CATALOGO_TECIDOS_MS) return Promise.reject(new Error("Prazo de consulta inválido."));
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const pagina = new AbortController();
    let encerrado = false;
    const limpar = () => { clearTimeout(timer); signal.removeEventListener("abort", cancelar); };
    const concluir = (valor: unknown) => { if (encerrado) return; encerrado = true; limpar(); resolve(valor); };
    const falhar = (erro: unknown) => { if (encerrado) return; encerrado = true; limpar(); reject(erro); };
    const cancelar = () => { pagina.abort(signal.reason); falhar(signal.reason); };
    signal.addEventListener("abort", cancelar, { once: true });
    const timer = setTimeout(() => {
      const erro = new Error("A consulta de produtos demorou mais que o esperado. Tente novamente para continuar o carregamento.");
      pagina.abort(erro); falhar(erro);
    }, prazoMs);
    try { void carregar(pagina.signal).then(concluir, falhar); } catch (erro) { falhar(erro); }
  });
}
