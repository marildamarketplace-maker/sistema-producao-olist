export type VersaoAnaliseEstampa = {
  content_hash?: string | null;
  ai_processed_hash?: string | null;
};

export function normalizarHashConteudo(hash: string | null | undefined): string | null {
  const normalizado = hash?.trim();
  return normalizado || null;
}

export function analiseCorrespondeAoConteudoAtual(estampa: VersaoAnaliseEstampa): boolean {
  const contentHash = normalizarHashConteudo(estampa.content_hash);
  if (!contentHash) return false;
  return contentHash === normalizarHashConteudo(estampa.ai_processed_hash);
}

export function estampaPrecisaReprocessamento(estampa: VersaoAnaliseEstampa): boolean {
  return (
    normalizarHashConteudo(estampa.content_hash) !== null &&
    !analiseCorrespondeAoConteudoAtual(estampa)
  );
}
