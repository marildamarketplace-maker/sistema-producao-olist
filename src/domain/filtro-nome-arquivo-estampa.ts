export const TERMOS_IGNORADOS_NOME_ARQUIVO_ESTAMPA = ["-", ".", "MOCKUP", "MOCLKUP"] as const;

export function normalizarTermosIgnoradosNomeArquivo(termos: readonly string[]): string[] {
  return [...new Set(termos.map(termo => termo.trim().toUpperCase()).filter(Boolean))];
}

// Avalia somente o nome base: diretórios e o ponto da extensão não contam.
export function nomeArquivoEstampaDeveSerIgnorado(
  nomeArquivo: string | null | undefined,
  termos: readonly string[],
): boolean {
  if (!nomeArquivo?.trim()) return false;
  const nome = nomeArquivo.trim().replaceAll("\\", "/").split("/").at(-1) ?? "";
  const semExtensao = nome.replace(/\.[^.]*$/u, "").toUpperCase();
  // Variante no final (-A, -F), seguida apenas por pontos, continua válida.
  const temVarianteValida = /-[A-Z0-9]+[.]*$/u.test(semExtensao);
  // Hífen separa variantes válidas. Só o hífen final é excluído.
  return normalizarTermosIgnoradosNomeArquivo(termos).some(termo =>
    termo === "-" ? semExtensao.endsWith("-")
      : termo === "." ? semExtensao.includes(".") && !temVarianteValida
      : semExtensao.includes(termo),
  );
}
