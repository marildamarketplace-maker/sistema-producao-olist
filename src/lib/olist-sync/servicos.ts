import type { CamposSync } from "./contrato";

export const VERSAO_SERVICOS_SYNC = 1;

/** Código preenchido é identidade exata; não remove zeros, caixa ou pontuação. */
export function codigoServicoSync(codigo: unknown): string | null {
  return typeof codigo === "string" && codigo.trim() && codigo.length <= 255 && !/\p{Cc}/u.test(codigo) ? codigo : null;
}

/** Equivalência exata normalizada; nunca usa similaridade ou remove acentos. */
export function nomeServicoSync(nome: unknown): string | null {
  if (typeof nome !== "string" || nome.length > 200 || /\p{Cc}/u.test(nome)) return null;
  const normalizado = nome.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
  return normalizado.length > 0 ? normalizado : null;
}

export function chaveServicoSync(campos: CamposSync): string | null {
  const codigo = codigoServicoSync(campos.codigo);
  if (codigo) return `codigo:${codigo}`;
  // Entrada inválida preenchida não se transforma silenciosamente em ausência.
  if (campos.codigo !== null && campos.codigo !== undefined &&
    (typeof campos.codigo !== "string" || campos.codigo.trim() !== "")) return null;
  const nome = nomeServicoSync(campos.nome);
  return nome ? `nome:${nome}` : null;
}
