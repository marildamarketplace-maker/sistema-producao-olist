import { z } from "zod";

// Mensagens fixas: stderr/stdout podem conter prompts, dados de páginas e secrets.
const descricoes = {
  MCP_INDISPONIVEL: "O Codex não conseguiu iniciar ou conectar a ferramenta de navegação MCP. Confira o serviço do navegador na VM.",
  ESQUEMA_REJEITADO: "O serviço recusou o formato de saída solicitado. Confira o schema enviado pelo worker.",
  DNS_INDISPONIVEL: "Não foi possível resolver o endereço de um serviço usado pelo Codex. Confira o DNS da VM.",
  CONEXAO_RECUSADA: "Uma conexão usada pelo Codex foi recusada. Confira se o serviço de destino está disponível.",
  CERTIFICADO_RECUSADO: "Uma conexão do Codex falhou na validação do certificado. Confira certificados e relógio da VM.",
  CONEXAO_INTERROMPIDA: "A conexão do Codex foi interrompida antes de concluir a resposta.",
  SERVICO_INDISPONIVEL: "Um serviço chamado pelo Codex retornou erro de disponibilidade.",
  TEMPO_LIMITE: "O processo do Codex excedeu o tempo permitido.",
  RESERVA_PERDIDA: "O worker interrompeu o Codex porque perdeu a reserva da tarefa.",
  EXECUTAVEL_AUSENTE: "O executável do Codex não foi encontrado na VM.",
  PERMISSAO_NEGADA: "O sistema recusou a execução ou o acesso a arquivos necessários ao Codex.",
  INICIALIZACAO_FALHOU: "Não foi possível iniciar o processo do Codex na VM.",
  SAIDA_EXCESSIVA: "A saída do Codex excedeu o limite de 2 MiB.",
  ENVIO_PROMPT_FALHOU: "Não foi possível entregar a entrada ao processo do Codex.",
  CAUSA_NAO_CLASSIFICADA: "O processo do Codex encerrou com erro sem uma causa reconhecida. O código de saída ajuda a investigar na VM.",
} as const;

export const diagnosticoCodexSchema = z.object({
  motivo: z.enum(Object.keys(descricoes) as [keyof typeof descricoes, ...(keyof typeof descricoes)[]]),
  codigoSaida: z.number().int().nullable().optional(),
  sinal: z.enum(["SIGTERM", "SIGKILL", "SIGINT", "SIGABRT", "SIGSEGV", "SIGBUS", "SIGPIPE", "SIGHUP"]).optional(),
});
export type DiagnosticoCodex = z.infer<typeof diagnosticoCodexSchema>;

export function descreverDiagnosticoCodex(diagnostico: DiagnosticoCodex) {
  return descricoes[diagnostico.motivo];
}

export function diagnosticarSaidaCodex(saida: string): DiagnosticoCodex {
  if (/invalid[_ ](?:json[_ ])?schema|invalid schema for response_format|schema.*(?:not supported|is not permitted)/i.test(saida)) return { motivo: "ESQUEMA_REJEITADO" };
  if (/MCP (?:client|server|startup).*?(?:failed|error|timed out)|(?:failed|error).*?(?:MCP (?:client|server)|handshak(?:e|ing).*?server)|mcp startup:\s*failed|required MCP servers?.*?(?:failed|not ready)/i.test(saida)) return { motivo: "MCP_INDISPONIVEL" };
  if (/ENOTFOUND|EAI_AGAIN|failed to lookup address|dns error|name or service not known/i.test(saida)) return { motivo: "DNS_INDISPONIVEL" };
  if (/certificate verify failed|invalid peer certificate|certificate has expired|CERT_HAS_EXPIRED|unable to get local issuer certificate/i.test(saida)) return { motivo: "CERTIFICADO_RECUSADO" };
  if (/ECONNREFUSED|connection refused/i.test(saida)) return { motivo: "CONEXAO_RECUSADA" };
  if (/ECONNRESET|connection reset|stream disconnected|connection closed|broken pipe/i.test(saida)) return { motivo: "CONEXAO_INTERROMPIDA" };
  if (/(?:status(?: code)?|HTTP)[: ]+(?:500|502|503|504)\b|service unavailable|bad gateway/i.test(saida)) return { motivo: "SERVICO_INDISPONIVEL" };
  return { motivo: "CAUSA_NAO_CLASSIFICADA" };
}
