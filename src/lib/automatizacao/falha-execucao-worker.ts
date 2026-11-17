import { ImageAnalysisProviderError } from "@/services/image-analysis/ImageAnalysisProviderError";
import { descreverDiagnosticoCodex, diagnosticoCodexSchema } from "@/services/image-analysis/diagnosticoCodexCli";

// Nunca copia error.message/details livres: o processo pode ter recebido dados
// privados da habilidade ou do navegador. Só aceita códigos e mensagens fixos.
export function detalharFalhaExecucaoWorker(error: unknown) {
  const codigo = error instanceof ImageAnalysisProviderError ? error.code : "SAIDA_INVALIDA";
  const detalhe = diagnosticoCodexSchema.safeParse(error instanceof ImageAnalysisProviderError ? error.details : undefined);
  const diagnostico = detalhe.success ? detalhe.data : undefined;
  const descricao = diagnostico && diagnostico.motivo !== "CAUSA_NAO_CLASSIFICADA"
    ? descreverDiagnosticoCodex(diagnostico)
    : codigo === "AUTHENTICATION_ERROR" ? "O login do Codex está ausente, expirado ou foi recusado. Confira a sessão do usuário operador."
    : codigo === "CONFIGURATION_ERROR" ? "A instalação, versão, permissões ou configuração do Codex impediram a execução."
    : codigo === "RATE_LIMIT" ? "O limite de uso do Codex foi atingido."
    : codigo === "TIMEOUT" ? "A execução do Codex foi interrompida por tempo limite ou perda da reserva."
    : codigo === "SAIDA_INVALIDA" ? "Não foi possível ler ou validar o resultado da execução."
    : diagnostico ? descreverDiagnosticoCodex(diagnostico)
    : "O executor não concluiu a tarefa; a causa técnica não foi reconhecida.";
  const processo = diagnostico?.codigoSaida !== undefined
    ? `\nProcesso: saída ${diagnostico.codigoSaida ?? "sem código"}${diagnostico.sinal ? `; sinal ${diagnostico.sinal}` : ""}.` : "";
  return {
    codigo, diagnostico,
    resultado: `${codigo}\n${diagnostico ? `${diagnostico.motivo}: ` : ""}${descricao}${processo}`,
    resumoWhatsapp: `${descricao} Veja o histórico do ERP.`,
  };
}
