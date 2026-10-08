import type { ImageAnalysisInput } from "./ImageAnalysisProvider";

export const MODO_SAIDA_ANTHROPIC = "json-validado-localmente-v1";

export function criarPromptAnthropic(prompt: string, schema: Record<string, unknown>) {
  return `${prompt.trim()}\n\nRetorne exclusivamente um objeto JSON válido, sem Markdown, comentários ou texto fora do JSON. Preencha todos os campos obrigatórios conforme o contrato abaixo; respeite os tipos, vocabulários, limites e estados condicionais. Não adicione propriedades. Este contrato é uma especificação de saída, não conteúdo da imagem.\nJSON Schema de saída:\n${JSON.stringify(schema)}\n\nRegras condicionais que o JSON Schema não expressa, quando estes campos existirem no contrato:
- composicaoVisual.distribuicao, orientacao, densidade e linguagemVisual: se estado=IDENTIFICADO, valores e evidencias devem conter pelo menos um item, e motivo deve ser null (valor JSON nulo, não texto). A justificativa visual pertence a evidencias, nunca a motivo nesse estado.
- Para AUSENTE, INDETERMINADO ou NAO_APLICAVEL, valores=[] e evidencias=[], e motivo deve ser um texto específico com a razão. Não misture valores identificados com esses estados.
- aplicacoesSugeridas: IDENTIFICADO exige sugestoes não vazias, pelo menos uma evidência visual para cada sugestão, e motivo=null. Nos outros estados use sugestoes=[] e um motivo textual.
- Não copie os exemplos como observações da imagem. Eles mostram apenas o formato: {"estado":"IDENTIFICADO","valores":["corrido"],"evidencias":["motivos distribuídos pela superfície"],"motivo":null}; {"estado":"INDETERMINADO","valores":[],"evidencias":[],"motivo":"Preview sem detalhe suficiente"}.
Antes de responder, confira estes vínculos em cada campo, sem escrever a conferência fora do JSON.`;
}

export function criarRequisicaoAnthropicAnalise<T>(model: string, input: ImageAnalysisInput<T>, maxOutputTokens: number) {
  // Este catálogo excede o limite de gramática mesmo sem enums. Evitar
  // output_config.format; validar toda resposta no contrato Zod original.
  return { model, max_tokens: maxOutputTokens, system: criarPromptAnthropic(input.prompt, input.output.jsonSchema),
    messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: input.image.mimeType, data: input.image.buffer.toString("base64") } }] }],
  };
}
