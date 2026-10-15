// Código puro: o gerador incorpora estas funções no nó Code do n8n.
export const ESTILOS = ['clássico', 'contemporâneo', 'minimalista', 'romântico', 'delicado', 'retrô', 'vintage', 'rústico', 'lúdico', 'esportivo', 'tropical', 'boho', 'outro'];
export const LINGUAGENS = ['aquarelado', 'vetorial', 'traço manual', 'fotográfico', 'textura simulada', 'colagem', 'outro'];

export function normalizarEvento(webhook, config) {
  if (config.serialProcessingConfirmed !== true) throw new Error('Configure processamento sequencial antes de ativar o piloto.');
  if (!config.instanceId || !config.webhookSecret || config.webhookSecret.length < 32 || !config.allowedPhones?.length) {
    throw new Error('Configure instância, segredo de pelo menos 32 caracteres e números autorizados antes de ativar.');
  }
  if (!/^https:\/\/api\.z-api\.io\/instances\/[A-Za-z0-9_-]+\/token\/[A-Za-z0-9_-]+\/?$/.test(config.instanceApi ?? '')) {
    throw new Error('Configure a URL da instância Z-API no domínio api.z-api.io.');
  }
  const b = webhook.body;
  if (webhook.query?.key !== config.webhookSecret || !b || b.instanceId !== config.instanceId) return null;
  if (b.fromMe !== false || b.isGroup !== false || b.isNewsletter || b.isStatusReply || b.isEdit || b.waitingMessage) return null;
  if (typeof b.phone !== 'string' || !/^\d{10,15}$/.test(b.phone) || !config.allowedPhones.includes(b.phone)) return null;
  if (typeof b.messageId !== 'string' || !b.messageId || b.messageId.length > 200) return null;
  const text = b.text?.message;
  if (typeof text !== 'string' || !text.trim() || text.length > 1000) return null;
  return { key: `${b.instanceId}:${b.phone}`, phone: b.phone, id: b.messageId, text: text.trim().replace(/\s+/gu, ' ') };
}

export function criarLink(dados) {
  // Codificação sem depender de URLSearchParams no sandbox do nó Code.
  const pares = [['status', 'COMPLETED'], ['pagina', '1'], ['ordenacao', 'RELEVANCIA'], ['modoCores', 'TODAS']];
  for (const campo of ['tema', 'estilo', 'linguagemVisual']) if (dados[campo]) pares.push([campo, dados[campo]]);
  for (const cor of dados.cores ?? []) pares.push(['cor', cor]);
  const ativos = ['tema', 'cores', 'estilo', 'linguagemVisual'].filter(c => c === 'cores' ? dados.cores?.length : dados[c]);
  const preferencias = dados.modo === '3' ? ativos : dados.modo === '2' ? ativos.filter(c => c !== 'tema') : [];
  pares.push(['preferencias', preferencias.join(',')], ['correspondenciaMinima', preferencias.length ? String(dados.minimo ?? 1) : '1']);
  return 'https://sistema.meuryshop.com.br/controle-midia/estampas?' + pares.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

export function pergunta(estado) {
  const sufixo = '\nComandos: pular, voltar, cancelar ou reiniciar.';
  const perguntas = {
    tema: 'Qual tema ou motivo você procura? Ex.: floral, cereja, geométrico.',
    cores: 'Quais cores? Separe por vírgulas (até 10). Ex.: amarelo, verde. Todas as cores informadas serão exigidas quando obrigatórias.',
    estilo: 'Qual estilo?\n' + ESTILOS.map((v, i) => `${i + 1}. ${v}`).join('\n'),
    linguagemVisual: 'Qual linguagem visual?\n' + LINGUAGENS.map((v, i) => `${i + 1}. ${v}`).join('\n'),
    modo: 'Como aplicar os critérios?\n1. Todos obrigatórios\n2. Tema obrigatório; demais como preferências\n3. Todos como preferências',
    minimo: 'Qual correspondência mínima das preferências? Responda de 1 a 100. Ex.: 100 exige todas; 1 aceita pelo menos uma.',
  };
  if (estado.etapa === 'confirmar') {
    const d = estado.dados;
    return `Confirme a pesquisa:\nTema: ${d.tema || 'não informado'}\nCores: ${d.cores?.join(', ') || 'não informadas'}\nEstilo: ${d.estilo || 'não informado'}\nLinguagem visual: ${d.linguagemVisual || 'não informada'}\nModo: ${d.modo}\nCorrespondência mínima: ${d.minimo ?? 1}% (apenas preferências)\nResponda confirmar, voltar, reiniciar ou cancelar.`;
  }
  return perguntas[estado.etapa] + sufixo;
}

export function avancarConversa(evento, anterior, agora = Date.now()) {
  const texto = evento.text.toLocaleLowerCase('pt-BR');
  const inicio = ['pesquisar estampas', 'pesquisar', 'reiniciar'].includes(texto);
  let estado = anterior ? JSON.parse(JSON.stringify(anterior)) : null;
  // Duplicatas não avançam a conversa nem disparam nova resposta.
  if (estado?.ids?.includes(evento.id)) return null;
  const expirado = !estado || agora - estado.atualizado > 30 * 60 * 1000;
  if (expirado || estado.etapa === 'fim') {
    if (!inicio) return null;
    estado = { etapa: 'tema', dados: {}, ids: [], atualizado: agora };
  } else if (inicio) {
    estado = { etapa: 'tema', dados: {}, ids: estado.ids, atualizado: agora };
  }
  const etapas = ['tema', 'cores', 'estilo', 'linguagemVisual', 'modo', 'minimo', 'confirmar'];
  let resposta;
  if (inicio) resposta = 'Vamos pesquisar estampas.\n' + pergunta(estado);
  else if (texto === 'cancelar') { estado.etapa = 'fim'; estado.dados = {}; resposta = 'Pesquisa cancelada. Envie pesquisar estampas para começar novamente.'; }
  else if (texto === 'voltar') {
    estado.etapa = etapas[Math.max(0, etapas.indexOf(estado.etapa) - 1)];
    resposta = pergunta(estado);
  } else if (estado.etapa === 'confirmar') {
    if (texto !== 'confirmar') resposta = pergunta(estado);
    else {
      const link = criarLink(estado.dados);
      estado.etapa = 'fim';
      estado.dados = {};
      resposta = `Abra a pesquisa com os critérios preenchidos:\n${link}\nÉ necessário estar conectado ao sistema e ter permissão para visualizar estampas.`;
    }
  } else {
    const etapa = estado.etapa;
    const pular = texto === 'pular';
    let erro = '';
    if (['tema', 'cores', 'estilo', 'linguagemVisual'].includes(etapa)) {
      if (pular) delete estado.dados[etapa];
      else if (etapa === 'cores') {
        const cores = [...new Set(texto.split(',').map(c => c.trim()).filter(Boolean))];
        if (!cores.length || cores.length > 10 || cores.some(c => c.length > 50)) erro = 'Informe de 1 a 10 cores, com até 50 caracteres cada.';
        else estado.dados.cores = cores;
      } else if (etapa === 'tema') {
        if (evento.text.length > 100) erro = 'O tema deve ter até 100 caracteres.';
        else estado.dados.tema = texto;
      } else {
        const opcoes = etapa === 'estilo' ? ESTILOS : LINGUAGENS;
        const valor = /^\d+$/.test(texto) ? opcoes[Number(texto) - 1] : texto;
        if (!opcoes.includes(valor)) erro = 'Escolha um número da lista ou escreva uma das opções.';
        else estado.dados[etapa] = valor;
      }
    } else if (etapa === 'modo') {
      if (!['1', '2', '3'].includes(texto)) erro = 'Escolha 1, 2 ou 3.';
      else if (texto === '2' && !estado.dados.tema) erro = 'Para exigir tema, volte e informe um tema; ou escolha 1 ou 3.';
      else estado.dados.modo = texto;
    } else if (etapa === 'minimo') {
      if (!/^\d{1,3}$/.test(texto) || Number(texto) < 1 || Number(texto) > 100) erro = 'Informe um inteiro de 1 a 100.';
      else estado.dados.minimo = Number(texto);
    }
    if (!erro && etapa === 'linguagemVisual' && !estado.dados.tema && !estado.dados.cores?.length && !estado.dados.estilo && !estado.dados.linguagemVisual) {
      estado.etapa = 'tema'; resposta = 'Informe pelo menos um critério.\n' + pergunta(estado);
    } else if (erro) resposta = erro + '\n' + pergunta(estado);
    else {
      estado.etapa = etapas[etapas.indexOf(etapa) + 1];
      if (estado.etapa === 'minimo' && estado.dados.modo === '1') estado.etapa = 'confirmar';
      resposta = pergunta(estado);
    }
  }
  estado.ids = [...(estado.ids ?? []), evento.id].slice(-100);
  estado.atualizado = agora;
  return { key: evento.key, phone: evento.phone, state: JSON.stringify(estado), message: resposta };
}
