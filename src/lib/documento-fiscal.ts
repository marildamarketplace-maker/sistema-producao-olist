/** Preserva letras e zeros do CNPJ alfanumérico; módulo 11 usa ASCII menos 48. */
export function normalizarDocumento(valor: unknown): string | null {
  if (typeof valor !== "string" || valor.length > 32) return null;
  const documento = valor.replace(/[.\/\-\s]/g, "").toUpperCase();
  if (/^(.)\1+$/.test(documento)) return null;
  const digito = (base: string, pesos: number[]) => {
    const resto = [...base].reduce((total, caractere, indice) => total + (caractere.charCodeAt(0) - 48) * pesos[indice], 0) % 11;
    return String(resto < 2 ? 0 : 11 - resto);
  };
  if (/^\d{11}$/.test(documento)) {
    const base = documento.slice(0, 9);
    const primeiro = digito(base, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const segundo = digito(base + primeiro, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    return documento === base + primeiro + segundo ? documento : null;
  }
  if (/^[A-Z0-9]{12}\d{2}$/.test(documento)) {
    const base = documento.slice(0, 12);
    const primeiro = digito(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const segundo = digito(base + primeiro, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return documento === base + primeiro + segundo ? documento : null;
  }
  return null;
}
