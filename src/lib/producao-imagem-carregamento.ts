// Coordena componentes duplicados do mesmo recurso sem compartilhar acessos entre tokens.
export function criarCarregadorImagens(fetchImagem: typeof fetch = (...args) => fetch(...args), limite = 3) {
  const contextos = new Map<string, Map<string, { ate: number; promessa: Promise<string> }>>();
  let ativos = 0;
  const fila: Array<() => void> = [];
  async function executar(endpoint: string, token: string, imagemInvalida?: string) {
    await new Promise<void>((resolve) => {
      const iniciar = () => { ativos++; resolve(); };
      if (ativos < limite) iniciar(); else fila.push(iniciar);
    });
    try {
      const response = await fetchImagem(endpoint, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, ...(imagemInvalida ? { "Content-Type": "application/json" } : {}) },
        body: imagemInvalida ? JSON.stringify({ imagemInvalida }) : undefined, cache: "no-store",
        referrerPolicy: "no-referrer", signal: AbortSignal.timeout(30_000),
      });
      const dados: unknown = await response.json();
      if (!dados || typeof dados !== "object") throw new Error("Resposta de imagem inválida.");
      if (!response.ok) throw new Error("error" in dados && typeof dados.error === "string" ? dados.error : "Não foi possível carregar a imagem.");
      if (!("imagemUrl" in dados) || typeof dados.imagemUrl !== "string" || !dados.imagemUrl) throw new Error("Nenhuma imagem encontrada. Tente novamente mais tarde.");
      const parsed = new URL(dados.imagemUrl);
      if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("URL de imagem inválida.");
      return parsed.href;
    } finally { ativos--; fila.shift()?.(); }
  }
  return (endpoint: string, token: string, imagemInvalida?: string, repetir = false): Promise<string> => {
    // Contextos expirados deixam de reter o token; o cache nunca usa dados de outra sessão.
    const agora = Date.now();
    for (const [credencial, recursos] of contextos) {
      for (const [recurso, entrada] of recursos) if (entrada.ate <= agora) recursos.delete(recurso);
      if (!recursos.size) contextos.delete(credencial);
    }
    let recursos = contextos.get(token);
    if (!recursos) { recursos = new Map(); contextos.set(token, recursos); }
    const chave = JSON.stringify([endpoint, imagemInvalida]);
    const atual = recursos.get(chave);
    if (atual && (!repetir || atual.ate === Infinity)) return atual.promessa;
    const entrada = { ate: Infinity, promessa: executar(endpoint, token, imagemInvalida) };
    recursos.set(chave, entrada);
    void entrada.promessa.then(() => { entrada.ate = Date.now() + 30_000; }, () => { entrada.ate = Date.now() + 30_000; });
    return entrada.promessa;
  };
}

export const carregarImagemProducao = criarCarregadorImagens();
