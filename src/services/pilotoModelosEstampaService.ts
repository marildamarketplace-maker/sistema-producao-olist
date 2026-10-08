import { createHash, randomUUID } from "node:crypto";
import { MAX_IMAGENS_PILOTO } from "@/config/pilotoEstampas";
import { AI_ANALYSIS_PROMPT_VERSION, AI_MAX_OUTPUT_TOKENS } from "@/config/ai";
import { analiseVisualEstampaStructuredOutput } from "@/schemas/analiseVisualEstampaSchema";
import { PROMPT_ANALISE_VISUAL_ESTAMPA } from "@/services/analisarVisualEstampaService";
import { avaliarQualidadeMetadados } from "@/services/avaliarQualidadeMetadados";
import { carregarPreviewEstampa } from "@/services/carregarPreviewEstampaService";
import { calcularCustoEstimadoAnaliseIa, obterPrecosModeloAnaliseIa } from "@/services/metricasCustoAnaliseIa";
import type { ImageAnalysisDetail, ImageAnalysisProvider, ImageAnalysisResult } from "@/services/image-analysis/ImageAnalysisProvider";
import { OpenAIImageAnalysisProvider } from "@/services/image-analysis/OpenAIImageAnalysisProvider";
import { CodexLocalImageAnalysisProvider } from "@/services/image-analysis/CodexLocalImageAnalysisProvider";
import { GeminiImageAnalysisProvider } from "@/services/image-analysis/GeminiImageAnalysisProvider";
import { AnthropicImageAnalysisProvider, MOTIVOS_ERRO_HTTP_ANTHROPIC } from "@/services/image-analysis/AnthropicImageAnalysisProvider";
import { criarPromptAnthropic, MODO_SAIDA_ANTHROPIC } from "@/services/image-analysis/anthropicAnaliseRequest";
import { criarSchemaGemini } from "@/services/image-analysis/geminiAnaliseRequest";
import { obterConfiguracaoGemini, type GeminiThinkingLevel } from "@/config/gemini";
import { ImageAnalysisProviderError } from "@/services/image-analysis/ImageAnalysisProviderError";
import { obterProblemasSchema } from "@/services/image-analysis/schemaValidationDiagnostics";
import { chaveCombinacaoPiloto, consolidarRegistrosPiloto } from "@/services/arquivoPilotoEstampas";
import { ErroEntradaPiloto } from "@/services/diagnosticoPilotoEstampas";

export const CONFIGURACOES_PILOTO = [
  { model: "gpt-4o-mini", detail: "low" },
  { model: "gpt-4o-mini", detail: "high" },
  { model: "gpt-5.4-mini", detail: "high" },
] as const;
export type ImagemPiloto = { id: string; preview_url: string };
export type ConfiguracaoPiloto = { provider?: "openai" | "gemini" | "anthropic" | "codex-local"; model: string; detail: ImageAnalysisDetail; thinkingLevel?: GeminiThinkingLevel; reasoningEffort?: "medium" | "high" };
export const CONFIGURACOES_PILOTO_CODEX: readonly ConfiguracaoPiloto[] = [
  { provider: "codex-local", model: "gpt-6.1-sol", detail: "auto", reasoningEffort: "high" },
  { provider: "codex-local", model: "gpt-6-astra", detail: "auto", reasoningEffort: "high" },
  { provider: "codex-local", model: "gpt-6-luna", detail: "auto", reasoningEffort: "medium" },
];
export const CONFIGURACOES_PILOTO_ANTHROPIC: readonly ConfiguracaoPiloto[] = [
  { provider: "anthropic", model: "claude-haiku-5-5", detail: "auto" },
  { provider: "anthropic", model: "claude-sonnet-5-5", detail: "auto" },
];
export function obterConfiguracoesPilotoGemini(): readonly ConfiguracaoPiloto[] {
  const config = obterConfiguracaoGemini();
  return ["gemini-3.5-flash-lite", "gemini-3.8-flash"].map(model => ({ provider: "gemini", model, detail: config.imageDetail, thinkingLevel: config.thinkingLevel }));
}
type DependenciasPiloto = {
  carregar?: typeof carregarPreviewEstampa;
  criarProvider?: (model: string, detail: ImageAnalysisDetail, configuracao: ConfiguracaoPiloto) => ImageAnalysisProvider;
  configuracoes?: readonly ConfiguracaoPiloto[];
  maxOutputTokens?: number;
  maxOutputTokensPorProvider?: Partial<Record<NonNullable<ConfiguracaoPiloto["provider"]>, number>>;
  anteriores?: readonly RegistroPiloto[];
  reutilizar?: (resultado: RegistroPiloto) => Promise<void>;
  providerIndisponivel?: (provider: string) => void;
};

export async function executarPilotoModelosEstampa(imagens: readonly ImagemPiloto[], registrar: (resultado: RegistroPiloto) => Promise<void>, dependencias: DependenciasPiloto = {}) {
  if (!imagens.length || imagens.length > MAX_IMAGENS_PILOTO || new Set(imagens.map(imagem => imagem.id)).size !== imagens.length) throw new Error(`Informe entre 1 e ${MAX_IMAGENS_PILOTO} imagens com IDs únicos.`);
  const carregar = dependencias.carregar ?? carregarPreviewEstampa;
  const configuracoes: readonly ConfiguracaoPiloto[] = dependencias.configuracoes ?? CONFIGURACOES_PILOTO;
  if (!configuracoes.length) throw new Error("Piloto exige ao menos uma configuração.");
  const limite = (configuracao: ConfiguracaoPiloto) => dependencias.maxOutputTokensPorProvider?.[configuracao.provider ?? "openai"] ?? dependencias.maxOutputTokens ?? AI_MAX_OUTPUT_TOKENS;
  const criarProvider = dependencias.criarProvider ?? ((model, imageDetail, configuracao) => configuracao.provider === "gemini"
    ? new GeminiImageAnalysisProvider({ model, imageDetail, thinkingLevel: configuracao.thinkingLevel, maxOutputTokens: limite(configuracao) })
    : configuracao.provider === "codex-local" ? new CodexLocalImageAnalysisProvider({ model, reasoningEffort: configuracao.reasoningEffort })
    : configuracao.provider === "anthropic" ? new AnthropicImageAnalysisProvider({ model, maxOutputTokens: limite(configuracao) }) : new OpenAIImageAnalysisProvider({ model, imageDetail }));
  const anteriores = new Map(consolidarRegistrosPiloto(dependencias.anteriores ?? []).map(item => [chaveCombinacaoPiloto(item), item]));
  const providersIndisponiveis = new Set<string>();
  // Uma única carga por imagem: todas as configurações recebem os mesmos bytes.
  // A ordem gira por imagem para reduzir viés de aquecimento/cache.
  for (const [indice, imagem] of imagens.entries()) {
    if (configuracoes.every(c => providersIndisponiveis.has(c.provider ?? "openai"))) break;
    const preview = await carregar(imagem);
    const imageHash = createHash("sha256").update(preview.buffer).digest("hex");
    for (let ordem = 0; ordem < configuracoes.length; ordem += 1) {
      const configuracao: ConfiguracaoPiloto = configuracoes[(indice + ordem) % configuracoes.length];
      const maxOutputTokens = limite(configuracao);
      const inicio = Date.now();
      const comum = { id: imagem.id, imageHash, configuracao, ordem, promptVersion: AI_ANALYSIS_PROMPT_VERSION,
        promptHash: createHash("sha256").update(configuracao.provider === "anthropic" ? criarPromptAnthropic(PROMPT_ANALISE_VISUAL_ESTAMPA, analiseVisualEstampaStructuredOutput.jsonSchema) : PROMPT_ANALISE_VISUAL_ESTAMPA).digest("hex"),
        schemaHash: createHash("sha256").update(JSON.stringify(configuracao.provider === "gemini" ? { local: analiseVisualEstampaStructuredOutput.jsonSchema, remoto: criarSchemaGemini(analiseVisualEstampaStructuredOutput.jsonSchema) } : configuracao.provider === "anthropic" ? { local: analiseVisualEstampaStructuredOutput.jsonSchema, modo: MODO_SAIDA_ANTHROPIC } : analiseVisualEstampaStructuredOutput.jsonSchema)).digest("hex"), maxOutputTokens };
      const anterior = anteriores.get(chaveCombinacaoPiloto(comum));
      if (anterior?.ok) {
        await dependencias.reutilizar?.(anterior);
        continue;
      }
      if (providersIndisponiveis.has(configuracao.provider ?? "openai")) continue;
      let registro: RegistroPiloto;
      try {
        const resultado = await criarProvider(configuracao.model, configuracao.detail, configuracao).analyzeImage({ image: preview, prompt: PROMPT_ANALISE_VISUAL_ESTAMPA, promptVersion: AI_ANALYSIS_PROMPT_VERSION, output: analiseVisualEstampaStructuredOutput });
        const precos = obterPrecosModeloAnaliseIa(resultado.model, resultado.analyzedAt, resultado.usage.inputTokens);
        const usoCompleto = resultado.usage.inputTokens !== null && resultado.usage.outputTokens !== null;
        registro = { ...comum, tentativaId: randomUUID(), ok: true, latencyMs: Date.now() - inicio, resultado,
          qualidade: avaliarQualidadeMetadados(resultado.data),
          custoEstimadoUsd: configuracao.provider !== "codex-local" && precos && usoCompleto ? calcularCustoEstimadoAnaliseIa(resultado.usage, precos).estimatedCostUsd : null,
          revisaoHumana: { precisaoVisual: null, utilidadePesquisa: null, observacao: null } };
      } catch (error) {
        const diagnostico = diagnosticarErroPiloto(error);
        const uso = diagnostico.usage;
        const precos = obterPrecosModeloAnaliseIa(configuracao.model, undefined, uso?.inputTokens);
        registro = { ...comum, tentativaId: randomUUID(), ok: false, latencyMs: Date.now() - inicio, erro: error instanceof ImageAnalysisProviderError ? error.code : "UNEXPECTED_ERROR", diagnostico,
          custoEstimadoUsd: configuracao.provider !== "codex-local" && precos && uso && uso.inputTokens !== null && uso.outputTokens !== null ? calcularCustoEstimadoAnaliseIa(uso, precos).estimatedCostUsd : null };
      }
      // Falha na gravação encerra o piloto: não gastar chamadas sem evidência salva.
      await registrar(registro);
      if (registro.erro === "AUTHENTICATION_ERROR") {
        const provider = configuracao.provider ?? "openai";
        providersIndisponiveis.add(provider);
        dependencias.providerIndisponivel?.(provider);
      }
      // Deficiências de conta/contrato não dependem da imagem. Salvar a falha
      // e parar, em vez de repetir a mesma requisição inválida no lote inteiro.
      const motivo = registro.diagnostico?.motivoHttp;
      if (configuracao.provider === "anthropic" && motivo && ["SALDO_INSUFICIENTE", "LIMITE_GASTO", "SCHEMA_COMPLEXO", "SCHEMA_INVALIDO", "MODELO_INVALIDO", "PARAMETRO_INVALIDO"].includes(motivo)) {
        throw new ErroEntradaPiloto(`Piloto interrompido: Anthropic ${motivo}. Falha salva; corrija a configuração ou o contrato antes de continuar.`);
      }
    }
  }
}

export type RegistroPiloto = {
  tentativaId?: string;
  id: string; imageHash: string; configuracao: ConfiguracaoPiloto; ordem: number;
  promptVersion: string; promptHash: string; schemaHash: string; maxOutputTokens: number;
  ok: boolean; latencyMs: number; custoEstimadoUsd: number | null;
  resultado?: Awaited<ReturnType<ImageAnalysisProvider["analyzeImage"]>>;
  qualidade?: ReturnType<typeof avaliarQualidadeMetadados>;
  erro?: string;
  diagnostico?: ReturnType<typeof diagnosticarErroPiloto>;
  revisaoHumana?: { precisaoVisual: null; utilidadePesquisa: null; observacao: null };
};

function diagnosticarErroPiloto(error: unknown): {
  retriable?: boolean;
  status?: number;
  validationIssues?: ReturnType<typeof obterProblemasSchema>;
  usage?: ImageAnalysisResult<unknown>["usage"];
  motivoHttp?: typeof MOTIVOS_ERRO_HTTP_ANTHROPIC[number];
} {
  if (!(error instanceof ImageAnalysisProviderError)) return {};
  const details = error.details && typeof error.details === "object" ? error.details as Record<string, unknown> : {};
  const issues = obterProblemasSchema({ issues: details.validationIssues }, analiseVisualEstampaStructuredOutput.jsonSchema);
  const rawUsage = details.usage && typeof details.usage === "object" ? details.usage as Record<string, unknown> : null;
  const token = (key: string) => rawUsage && typeof rawUsage[key] === "number" && Number.isSafeInteger(rawUsage[key]) && rawUsage[key] >= 0 ? rawUsage[key] as number : null;
  const usage = rawUsage ? { inputTokens: token("inputTokens"), outputTokens: token("outputTokens"), totalTokens: token("totalTokens"), cachedInputTokens: token("cachedInputTokens") } : undefined;
  const motivoHttp = MOTIVOS_ERRO_HTTP_ANTHROPIC.find(motivo => motivo === details.motivoHttp);
  return { retriable: error.retriable, status: error.status, validationIssues: issues, usage, ...(motivoHttp ? { motivoHttp } : {}) };
}
