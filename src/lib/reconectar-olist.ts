type SessaoResultado = {
  data: { session: { access_token: string } | null };
  error: unknown;
};

type Autenticacao = {
  getSession: () => Promise<SessaoResultado>;
  refreshSession: () => Promise<SessaoResultado>;
};

type RespostaReconexao = {
  status: number;
  data: { login_url?: string; error?: string };
};

const SESSAO_INVALIDA = "Sua sessão do sistema expirou ou é inválida. Entre novamente para conectar a Olist.";

export async function solicitarReconexaoOlist(
  auth: Autenticacao,
  enviar: (token: string) => Promise<RespostaReconexao>,
): Promise<string> {
  const atual = await auth.getSession();
  if (atual.error || !atual.data.session?.access_token) {
    throw new Error(SESSAO_INVALIDA);
  }

  let resposta = await enviar(atual.data.session.access_token);
  // O servidor rejeitou a sessão local: renove uma única vez, sem repetir outros erros.
  if (resposta.status === 401) {
    const renovada = await auth.refreshSession();
    if (renovada.error || !renovada.data.session?.access_token) {
      throw new Error(SESSAO_INVALIDA);
    }
    resposta = await enviar(renovada.data.session.access_token);
  }

  if (resposta.status === 401) throw new Error(SESSAO_INVALIDA);
  if (resposta.status < 200 || resposta.status >= 300) {
    throw new Error(`Erro ao reconectar Olist: ${resposta.data.error ?? "desconhecido"}`);
  }
  return resposta.data.login_url ?? "/api/olist/login";
}
