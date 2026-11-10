const nomes: Record<string, string> = {
  "processar-publicar-videos": "Publicação de vídeos",
  "responder-avaliacoes-marketplaces": "Respostas às avaliações dos marketplaces",
  "shopee-impulsionar-produtos": "Impulsionamento de produtos na Shopee",
  "shopee-agendar-transmissao-chat": "Agendamento de mensagens na Shopee",
};

function nomeLegivel(nome: string) {
  const limpo = nome.replace(/[\r\n\t\u0000-\u001f]/g, " ")
    .replace(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi, "")
    .replace(/[*_~`]/g, "").trim();
  return nomes[limpo] ?? (limpo.replace(/[-_]+/g, " ").replace(/\s+/g, " ").slice(0, 120) || "Rotina de automatização");
}

// Não encaminha a resposta bruta do executor: pode conter dados de clientes ou secrets.
function motivoFalha(resultado: string) {
  if (/aprova[çc][aã]o|approval/i.test(resultado)) return "O acesso necessário para realizar a tarefa não foi autorizado.";
  if (/captcha|mfa|duplo fator|verifica[çc][aã]o.*(?:login|conta)/i.test(resultado)) return "É necessário concluir uma verificação de segurança no navegador.";
  if (/AUTHENTICATION_ERROR|login|autentica|sess[aã]o.*expir/i.test(resultado)) return "É necessário verificar o login da conta usada pela rotina.";
  if (/RESERVA_EXPIRADA|TIMEOUT|tempo.*(?:limite|esgot)/i.test(resultado)) return "A execução foi interrompida antes de confirmar o resultado.";
  if (/RATE_LIMIT|limite de uso|quota/i.test(resultado)) return "O limite de uso do executor foi atingido.";
  if (/CONFIGURATION_ERROR|configura[çc][aã]o|ferramenta.*indispon/i.test(resultado)) return "Uma ferramenta ou configuração necessária está indisponível.";
  return "Não foi possível confirmar a conclusão da tarefa.";
}

export function mensagemWhatsappAutomatizacao(nome: string, sucesso: boolean, resultado: string, encerradaEm: Date) {
  const horario = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(encerradaEm);
  return {
    titulo: sucesso ? "✅ Rotina concluída" : "⚠️ Rotina precisa de atenção",
    mensagem: [
      nomeLegivel(nome),
      sucesso ? "A execução foi concluída com sucesso." : motivoFalha(resultado),
      `Finalizada em ${horario} (horário de Brasília).`,
      sucesso ? "Confira o resultado em Automatização → Histórico no ERP."
        : "Confira os detalhes no Histórico da automatização.",
    ].join("\n\n"),
  };
}
