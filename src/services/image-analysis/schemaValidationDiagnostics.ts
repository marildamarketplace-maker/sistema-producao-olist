// Guarde apenas códigos e caminhos conhecidos do contrato, nunca valores ou
// mensagens do parser (que podem incluir conteúdo da imagem ou campos extras).
export function obterProblemasSchema(error: unknown, schema: unknown): Array<{ code: string; path: Array<string | number> }> {
  const campos = new Set<string>();
  const visitar = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visitar); return; }
    const object = value as Record<string, unknown>;
    if (object.properties && typeof object.properties === "object") Object.keys(object.properties).forEach(key => campos.add(key));
    Object.values(object).forEach(visitar);
  };
  visitar(schema);
  if (!error || typeof error !== "object" || !("issues" in error) || !Array.isArray(error.issues)) return [];
  const codigos = new Set(["invalid_type", "too_big", "too_small", "invalid_format", "not_multiple_of", "unrecognized_keys", "invalid_union", "invalid_key", "invalid_element", "invalid_value", "custom"]);
  return error.issues.slice(0, 30).flatMap((issue: unknown) => {
    if (!issue || typeof issue !== "object") return [];
    const item = issue as { code?: unknown; path?: unknown };
    if (typeof item.code !== "string" || !codigos.has(item.code) || !Array.isArray(item.path)) return [];
    return [{ code: item.code, path: item.path.slice(0, 10).map((part: unknown) => typeof part === "number" && Number.isSafeInteger(part) && part >= 0 ? part : typeof part === "string" && campos.has(part) ? part : "campoNaoReconhecido") }];
  });
}
