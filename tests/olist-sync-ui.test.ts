import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { permissionKeys, permissoesSincronizacaoParaAplicativo } from "../src/lib/permissions";
import { paginasPermitidas } from "../src/lib/navigation";
import { execucaoSyncAtiva, intervaloPollingSync, textoValorSync, type PendenciaSyncDetalheDto, type RegistroSyncDto } from "../src/lib/olist-sync/api-contract";
import { ComparacaoSync, OrigemSync, PaginacaoSync, PrevisaoValidacaoSync } from "../src/components/olist-sync-ui";
import { calcularPrevisaoValidacaoSync } from "../src/lib/olist-sync/previsao";
import { DecisaoSyncDialog, ExecutarSyncDialog } from "../src/components/olist-sync-decisoes";
import { ConfiguracaoIncrementalSync } from "../src/components/olist-sync-incremental";
import type { ConfiguracaoSyncDto } from "../src/lib/olist-sync/api-contract";

const todas = { podeVisualizarSincronizacaoOlist: true, podeExecutarSincronizacaoOlist: true, podeResolverSincronizacaoOlist: true, podeConfigurarSincronizacaoOlist: true };

test("previsão informa data local, amostra e limite da estimativa sem depender de cor", () => {
  const previsao = calcularPrevisaoValidacaoSync({ execucaoId: "execucao", agora: new Date("2026-11-17T21:00:00Z"), iniciadaEm: new Date("2026-11-17T12:00:00Z"),
    contadores: { listados: 1000, analisados: 400 }, validadosNaJanela: 300, pausada: false, listagemPendente: false });
  const html = renderToStaticMarkup(React.createElement(PrevisaoValidacaoSync, { previsao, falhou: false }));
  assert.match(html, /Fim previsto da validação/);assert.match(html, /17\/11\/2026/);assert.match(html, /19:00:00/);
  assert.match(html, /10 validações\/min/);assert.match(html, /300 na janela de até 30 min/);
  assert.match(html, /datetime="2026-11-17T22:00:00.000Z"/i);
  assert.match(html, /comparação e aplicação podem levar tempo adicional/i);
  const erro = renderToStaticMarkup(React.createElement(PrevisaoValidacaoSync, { previsao: null, falhou: true }));
  assert.match(erro, /Tente Atualizar novamente/);assert.doesNotMatch(erro, /<time/);
});

test("sincronização exige permissão específica do aplicativo pai e não expande administração global", () => {
  for (const chave of Object.keys(todas)) assert.ok(permissionKeys.includes(chave as keyof typeof todas));
  assert.deepEqual(Object.values(permissoesSincronizacaoParaAplicativo(todas, false)), [false, false, false, false]);
  assert.deepEqual(permissoesSincronizacaoParaAplicativo(todas, true), todas);
  const permitidas = paginasPermitidas(permissoesSincronizacaoParaAplicativo(todas, true));
  assert.ok(permitidas.some((pagina) => pagina.href === "/olist/sincronizacao"));
  assert.ok(!permitidas.some((pagina) => pagina.href === "/configuracoes" || pagina.href === "/usuarios"));
  assert.ok(!paginasPermitidas({ podeEditarConfiguracao: true }).some((pagina) => pagina.href === "/olist/sincronizacao"));
  assert.ok(!paginasPermitidas(permissoesSincronizacaoParaAplicativo(todas, false)).some((pagina) => pagina.href === "/olist/sincronizacao"));
});

test("polling termina com execução, pausa em aba oculta e limita tentativas durante falhas", () => {
  for (const status of ["PENDENTE", "AUDITANDO", "APLICANDO", "AGUARDANDO_RETRY"]) {
    assert.equal(execucaoSyncAtiva(status), true);
    assert.equal(intervaloPollingSync(status, true, 0), 10_000);
    assert.equal(intervaloPollingSync(status, false, 0), null);
  }
  for (const status of ["CONCLUIDA", "CONCLUIDA_COM_PENDENCIAS", "FALHOU", "CANCELADA", "DESCONHECIDO"]) assert.equal(intervaloPollingSync(status, true, 0), null);
  assert.equal(intervaloPollingSync(null, true, 0), null);
  assert.equal(intervaloPollingSync("AUDITANDO", true, 1), 20_000);
  assert.equal(intervaloPollingSync("AUDITANDO", true, 2), 40_000);
  assert.equal(intervaloPollingSync("AUDITANDO", true, 30), 60_000);
});

const detalhe: PendenciaSyncDetalheDto = {
  id: "pendencia", registroId: "registro", entidade: "PRODUTO", tipo: "CAMPOS_DIVERGENTES", severidade: "ALTA", status: "AGUARDANDO_REVISAO", versao: 3, criadoEm: "2026-11-16T12:00:00Z", resumo: "Descrições divergentes",
  comparacao: [
    { aplicativoId: "filho1", nome: "Filho 1", registroOlistId: "123", campos: { descricao: '<img src=x onerror="alert(1)">', unidade: "UN" } },
    { aplicativoId: "filho2", nome: "Filho 2", registroOlistId: "456", campos: { descricao: "Toalha", unidade: "UN" } },
  ], acoesPermitidas: ["APROVAR", "REJEITAR", "IGNORAR", "REAUDITAR"],
};

test("comparação preserva empresas, diferenças e escape HTML sem depender de hover", () => {
  const html = renderToStaticMarkup(React.createElement(ComparacaoSync, { detalhe }));
  assert.match(html, /Filho 1/); assert.match(html, /Filho 2/);
  assert.match(html, /ID Olist 123/); assert.match(html, /ID Olist 456/);
  assert.match(html, /descricao · divergente/);
  assert.doesNotMatch(html, /unidade · divergente/);
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/);
  assert.equal(textoValorSync(undefined), "Não informado");
  assert.equal(textoValorSync(null), "Vazio");
  assert.equal(textoValorSync(false), "Não");
});

test("revisão mantém permissão, ação permitida pelo servidor e reason obrigatório", () => {
  const props = { detalhe, empresas: [], podeResolver: false, fechar: () => {}, decidir: async () => {} };
  const semPermissao = renderToStaticMarkup(React.createElement(DecisaoSyncDialog, props));
  assert.doesNotMatch(semPermissao, /Registrar decisão/);
  const html = renderToStaticMarkup(React.createElement(DecisaoSyncDialog, { ...props, podeResolver: true }));
  assert.match(html, /Registrar decisão/); assert.match(html, /minLength="10"/);
  assert.match(html, /aria-modal="true"/); assert.match(html, /aria-labelledby="olist-sync-dialog-title"/);
  assert.doesNotMatch(html, /Vincular equivalentes/);
  const fechado = renderToStaticMarkup(React.createElement(DecisaoSyncDialog, { ...props, podeResolver: true, detalhe: { ...detalhe, status: "APROVADA" } }));
  assert.doesNotMatch(fechado, /Registrar decisão/);
});

test("formulário de nova execução começa somente auditando e bloqueia aplicação sem liberação", () => {
  const html = renderToStaticMarkup(React.createElement(ExecutarSyncDialog, { fechar: () => {}, executar: async () => {}, permiteAplicar: false, limite: 10 }));
  assert.match(html, /value="AUDITAR" selected=""/);
  assert.match(html, /value="AUDITAR_E_APLICAR" disabled=""/);
  assert.match(html, /value="APLICAR" disabled=""/);
  assert.match(html, /Enfileirar execução/); assert.match(html, /Aplicação indisponível/);
  assert.match(html, /Forçar auditoria completa/); assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /modo automático/);
});

test("validação incremental é por empresa e entidade, sem certificado automático nem criação de baseline", () => {
  const configuracao: ConfiguracaoSyncDto = {
    id: "grupo", aplicativoPaiId: "pai", aplicativoPaiNome: "Pai", versao: 1, ativo: true, entidades: ["PRODUTO"],
    participantes: [{ id: "filho", nome: "Empresa selecionada", habilitado: true }], aplicativosElegiveis: [{ id: "filho", nome: "Empresa selecionada", habilitado: true }, { id: "fora", nome: "Empresa fora do grupo", habilitado: false }], aplicativosOrigem: [], horaDiaria: "02:00", fusoHorario: "America/Sao_Paulo", limiteAlteracoes: 10, proximaExecucaoEm: null, prontidao: { incrementalValidado: true, semanticaPutValidada: false, sincronizacaoNativaCompativel: false }, jobs: [],
    incremental: { versaoContrato: 1, completaCadaDias: 15, sobreposicaoHoras: 24, coberturas: [{ aplicativoId: "filho", entidade: "PRODUTO", contaIdentificada: true, validado: false, fusoHorario: null, validadoEm: null, completaEm: null, incrementalEm: null, watermarkConfirmado: null }] },
  };
  const props = { configuracao, participantesIds: ["filho"], entidades: configuracao.entidades, validacoes: [], disabled: false, alterar: () => {} };
  const html = renderToStaticMarkup(React.createElement(ConfiguracaoIncrementalSync, props));
  for (const texto of ["Empresa selecionada", "Não validado para a conta atual", "Última completa", "Última incremental", "15 dias", "24 horas", "declaração do responsável"]) assert.ok(html.includes(texto), texto);
  assert.doesNotMatch(html, /Empresa fora do grupo|checked=""/);
  const declarando = renderToStaticMarkup(React.createElement(ConfiguracaoIncrementalSync, { ...props, validacoes: [{ aplicativoId: "filho", entidade: "PRODUTO", validado: true, fusoHorario: "", versaoContrato: 1 }] }));
  assert.match(declarando, /Fuso confirmado na API/); assert.match(declarando, /minLength="20"/); assert.match(declarando, /não cria cobertura/);
});

test("equivalência manual usa IDs por empresa e mantém somente os participantes habilitados", () => {
  const html = renderToStaticMarkup(React.createElement(DecisaoSyncDialog, {
    detalhe: { ...detalhe, entidade: "FORMA_PAGAMENTO", acoesPermitidas: ["VINCULAR"], comparacao: [] },
    empresas: [{ id: "filho1", nome: "Filial", habilitado: true }, { id: "filho2", nome: "Outra empresa", habilitado: true }, { id: "historico", nome: "Empresa histórica", habilitado: false }],
    podeResolver: true, fechar: () => {}, decidir: async () => {},
  }));
  assert.match(html, /Registros equivalentes nas empresas/);
  assert.match(html, /ID Olist 1/); assert.match(html, /ID Olist 2/);
  assert.match(html, /não cria nem altera cadastros na Olist/);
  assert.doesNotMatch(html, /Empresa histórica/);
  assert.doesNotMatch(html, /Aplicativo de referência/);
});

test("origem observada não afirma autoria histórica e difere da última fonte", () => {
  const registro: RegistroSyncDto = {
    id: "r", entidade: "PRODUTO", chaveExibicao: "0001", nome: "Toalha", revisao: 2,
    origemTipo: "OBSERVADA_PELO_MODULO", aplicativoOrigemId: "filho1", registroOlistOrigemId: "123", origemRegistradaEm: "2026-11-16T12:00:00Z", ultimaFonteAppId: "filho2", estados: [],
  };
  const html = renderToStaticMarkup(React.createElement(OrigemSync, { registro, empresas: [{ id: "filho1", nome: "Empresa de origem", habilitado: false }, { id: "filho2", nome: "Última empresa", habilitado: true }] }));
  for (const texto of ["Origem observada", "Empresa de origem", "Última empresa", "não comprova o criador histórico"]) assert.ok(html.includes(texto));
  const desconhecida = renderToStaticMarkup(React.createElement(OrigemSync, { registro: { ...registro, origemTipo: "DESCONHECIDA", aplicativoOrigemId: null, registroOlistOrigemId: null }, empresas: [] }));
  assert.match(desconhecida, /Origem desconhecida/); assert.doesNotMatch(desconhecida, /Aplicativo original/);
});

test("paginação não permite ultrapassar a última página nem repetir navegação durante carga", () => {
  const html = renderToStaticMarkup(React.createElement(PaginacaoSync, { offset: 0, total: 20, limit: 25, ocupado: false, mudar: () => {} }));
  assert.match(html, /disabled="">Anterior/); assert.match(html, /disabled="">Próxima/);
  assert.match(html, /1–20 de 20/);
  const carregando = renderToStaticMarkup(React.createElement(PaginacaoSync, { offset: 25, total: 100, limit: 25, ocupado: true, mudar: () => {} }));
  assert.match(carregando, /disabled="">Anterior/); assert.match(carregando, /disabled="">Próxima/);
});
