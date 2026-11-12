function nomeLegivel(nome: string) {
  const limpo = nome.replace(/[\r\n\t\u0000-\u001f]/g, " ")
    .replace(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi, "")
    .replace(/[*_~`]/g, "").trim();
  return limpo.replace(/\s+/g, " ").slice(0, 120) || "Rotina de automatização";
}

// Códigos internos continuam tendo uma descrição legível para o destinatário.
function motivoFalha(resultado: string) {
  if (/aprova[çc][aã]o|approval/i.test(resultado)) return "Acesso não autorizado.";
  if (/captcha|mfa|duplo fator|verifica[çc][aã]o.*(?:login|conta)/i.test(resultado)) return "Verificação de segurança pendente.";
  if (/AUTHENTICATION_ERROR|login|autentica|sess[aã]o.*expir/i.test(resultado)) return "Login necessário.";
  if (/RESERVA_EXPIRADA|TIMEOUT|tempo.*(?:limite|esgot)/i.test(resultado)) return "Execução interrompida.";
  if (/RATE_LIMIT|limite de uso|quota/i.test(resultado)) return "Limite de uso atingido.";
  if (/CONFIGURATION_ERROR|configura[çc][aã]o|ferramenta.*indispon/i.test(resultado)) return "Ferramenta indisponível.";
  return "Não foi possível concluir.";
}

function resultadoLegivel(resultado: string, sucesso: boolean) {
  const texto = resultado.trim();
  if (!texto) return "Resultado não informado.";
  if (/^[A-Z][A-Z_]+$/.test(texto)) {
    return sucesso ? "Execução concluída." : motivoFalha(texto);
  }
  // Defesa adicional; o executor também deve produzir resumos sem dados privados.
  const limpo = texto
    .replace(/\b(?:bearer\s+\S+|(?:token|password|senha|secret|api[_-]?key|authorization|cookie)\s*[:=]\s*[^\r\n]+)/gi, "[credencial omitida]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[e-mail omitido]")
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, "[identificador omitido]")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim();
  const caracteres = Array.from(limpo);
  return caracteres.length > 3_000 ? `${caracteres.slice(0, 2_999).join("")}…` : limpo || "Resultado não informado.";
}

export function mensagemWhatsappAutomatizacao(nome: string, sucesso: boolean, resultado: string, data = new Date(), bloqueada = false) {
  const horario = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(data);
  const nomeRotina = nomeLegivel(nome);
  return {
    titulo: `${bloqueada && !sucesso ? "⚠️" : sucesso ? "✅" : "❌"} ${nomeRotina}${bloqueada && !sucesso ? " | Intervenção necessária" : ""}`,
    mensagem: `Execução: ${horario}\nResultado: ${resultadoLegivel(resultado, sucesso)}`,
  };
}
