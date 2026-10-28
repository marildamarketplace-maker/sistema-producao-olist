export function normalizarVariantesPermitidas(variantes: readonly string[]): string[] {
  return [...new Set(variantes.map(v => v.trim().toUpperCase()).filter(Boolean))];
}

export function varianteEstampaPermitida(variante: string | null | undefined, permitidas: readonly string[]): boolean {
  const variantes = normalizarVariantesPermitidas(permitidas);
  return variantes.length === 0 || variantes.includes(variante?.trim().toUpperCase() ?? "");
}
