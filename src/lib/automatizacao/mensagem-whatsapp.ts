function nomeLegivel(nome: string) {
  const limpo = nome.replace(/[\r\n\t\u0000-\u001f]/g, " ")
    .replace(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi, "")
    .replace(/[*_~`]/g, "").trim();
  return limpo.replace(/\s+/g, " ").slice(0, 120) || "Rotina de automatização";
}

// Não encaminha a resposta bruta do executor: pode conter dados de clientes ou secrets.
function motivoFalha(resultado: string) {
  if (/aprova[çc][aã]o|approval/i.test(resultado)) return "Acesso não autorizado.";
  if (/captcha|mfa|duplo fator|verifica[çc][aã]o.*(?:login|conta)/i.test(resultado)) return "Verificação de segurança pendente.";
  if (/AUTHENTICATION_ERROR|login|autentica|sess[aã]o.*expir/i.test(resultado)) return "Login necessário.";
  if (/RESERVA_EXPIRADA|TIMEOUT|tempo.*(?:limite|esgot)/i.test(resultado)) return "Execução interrompida.";
  if (/RATE_LIMIT|limite de uso|quota/i.test(resultado)) return "Limite de uso atingido.";
  if (/CONFIGURATION_ERROR|configura[çc][aã]o|ferramenta.*indispon/i.test(resultado)) return "Ferramenta indisponível.";
  return "Não foi possível concluir.";
}

export function mensagemWhatsappAutomatizacao(nome: string, sucesso: boolean, resultado: string, data = new Date()) {
  const horario = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(data);
  const nomeRotina = nomeLegivel(nome);
  const status = sucesso ? "✅ Concluída." : "❌ Falha final.";
  return {
    titulo: `${sucesso ? "✅" : "❌"} ${nomeRotina}`,
    mensagem: `Rotina: ${nomeRotina}\nExecução: ${horario} (Brasília)\nStatus: ${status}${sucesso ? "" : `\nMotivo: ${motivoFalha(resultado)}`}`,
  };
}
