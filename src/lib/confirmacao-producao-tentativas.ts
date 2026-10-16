const MAX_TENTATIVAS_SENHA = 5;
const JANELA_TENTATIVAS_MS = 15 * 60 * 1_000;

type RegistroTentativas = { tentativas: number; bloqueadoAte: number };
const globalRateLimit = globalThis as typeof globalThis & {
  confirmacaoProducaoRateLimit?: Map<string, RegistroTentativas>;
};
const tentativasSenha = globalRateLimit.confirmacaoProducaoRateLimit
  ?? new Map<string, RegistroTentativas>();
globalRateLimit.confirmacaoProducaoRateLimit = tentativasSenha;

export function estaBloqueado(chave: string, agora = Date.now()) {
  const registro = tentativasSenha.get(chave);
  if (!registro) return false;
  if (registro.bloqueadoAte <= agora) {
    tentativasSenha.delete(chave);
    return false;
  }
  return registro.tentativas >= MAX_TENTATIVAS_SENHA;
}

export function registrarSenhaInvalida(chave: string, agora = Date.now()) {
  const atual = tentativasSenha.get(chave);
  if (!atual || atual.bloqueadoAte <= agora) {
    tentativasSenha.set(chave, {
      tentativas: 1,
      bloqueadoAte: agora + JANELA_TENTATIVAS_MS,
    });
    return;
  }
  atual.tentativas += 1;
}


export function limparTentativasSenha(chave: string) {
  tentativasSenha.delete(chave);
}
