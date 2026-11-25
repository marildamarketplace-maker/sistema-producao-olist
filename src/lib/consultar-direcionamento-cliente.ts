class FalhaConsulta extends Error {
  constructor(message: string, readonly temporaria: boolean) { super(message); }
}
function aguardar(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abortar = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abortar); resolve(); }, ms);
    if (signal.aborted) abortar(); else signal.addEventListener("abort", abortar, { once: true });
  });
}
/** Somente leitura: até três tentativas, com timeout e cancelamento da seleção anterior. */
export async function consultarDirecionamentoCliente(url: string, token: string, signal: AbortSignal,
  dependencias = { fetch, aguardar }) : Promise<unknown> {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    signal.throwIfAborted();
    try {
      const r = await dependencias.fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), cache: "no-store" });
      if (!r.ok) {
        const dados: unknown = await r.json().catch(() => null);
        const mensagem = dados && typeof dados === "object" && "error" in dados && typeof dados.error === "string" ? dados.error : "Não foi possível definir o aplicativo.";
        throw new FalhaConsulta(mensagem, [408,429,500,502,503,504].includes(r.status));
      }
      return await r.json();
    } catch (erro) {
      if (signal.aborted || (erro instanceof FalhaConsulta && !erro.temporaria) || tentativa === 2) throw erro;
      await dependencias.aguardar(1000 * (tentativa + 1), signal);
    }
  }
  throw new Error("Não foi possível definir o aplicativo.");
}
