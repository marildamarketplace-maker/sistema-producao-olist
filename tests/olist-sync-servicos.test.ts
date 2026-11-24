import assert from "node:assert/strict";
import test from "node:test";
import { FalhaSync, type ReplicaComparacao } from "../src/lib/olist-sync/contrato";
import { criarClienteSync, type RequisicaoSync, type RespostaHttpSync } from "../src/lib/olist-sync/cliente";
import { avaliarReplicas, observarRegistro, prepararPayload } from "../src/lib/olist-sync/dominio";
import { serializarCanonico } from "../src/lib/olist-sync/cripto";
import { chaveServicoSync } from "../src/lib/olist-sync/servicos";

const servico = { id: 10, codigo: "001-Ab", nome: "Bordado industrial", situacao: "A", unidade: "UN" };
const pagina = (itens: unknown[], total = itens.length) => ({ itens, paginacao: { total, offset: 0, limit: 100 } });
const mock = (respostas: Array<RespostaHttpSync | Error>) => {
  const chamadas: RequisicaoSync[] = [];
  const cliente = criarClienteSync({
    configurar: async () => ({ apiBaseUrl: "https://api.tiny.com.br/public-api/v3" }),
    token: async () => "credencial-ficticia",
    http: async r => {
      chamadas.push(r);
      const resposta = respostas.shift();
      if (resposta instanceof Error) throw resposta;
      assert.ok(resposta, "Chamada remota inesperada");return resposta;
    },
  });
  return { cliente, chamadas };
};

test("serviço usa código exato com zeros e caixa e mantém identidades por nome em outro namespace", () => {
  assert.equal(chaveServicoSync(servico), "codigo:001-Ab");
  assert.notEqual(chaveServicoSync(servico), chaveServicoSync({ ...servico, codigo: "001-ab" }));
  assert.notEqual(chaveServicoSync({ codigo: "nome:bordado", nome: "Outro" }), chaveServicoSync({ codigo: null, nome: "Bordado" }));
  assert.equal(chaveServicoSync({ codigo: "001-Ab", nome: "Nome diferente" }), chaveServicoSync(servico));
});

test("serviço sem código usa nome exato normalizado preservando acentos e pontuação", () => {
  for (const codigo of [null, undefined, "", "   "]) {
    assert.equal(chaveServicoSync({ ...(codigo === undefined ? {} : { codigo }), nome: "  Aplicação   de Bordado " }), "nome:aplicação de bordado");
    assert.equal(chaveServicoSync({ ...(codigo === undefined ? {} : { codigo }), nome: "ＡＰＬＩＣＡÇÃＯ de Bordado" }), "nome:aplicação de bordado");
  }
  assert.notEqual(chaveServicoSync({ nome: "Aplicação" }), chaveServicoSync({ nome: "Aplicacao" }));
  assert.notEqual(chaveServicoSync({ nome: "Corte-costura" }), chaveServicoSync({ nome: "Corte costura" }));
  assert.equal(chaveServicoSync({ codigo: null, nome: "   " }), null);
  for (const codigo of [123, {}, [], true]) assert.equal(chaveServicoSync({ codigo, nome: "Bordado" }), null);
});

test("serviços não exigem Ref e projetam somente dados cadastrais permitidos", () => {
  const camposProtegidos = { preco: 100, tipoItemSped: "09", nbs: "123", codigoListaServicos: "0101" };
  const obs = observarRegistro("SERVICO", { ...servico, descricaoComplementar: "Bordado até 20 cm", observacoes: "Aplicação", ...camposProtegidos }, { completo: true });
  assert.equal(obs.chave, "codigo:001-Ab");assert.equal(obs.nome, servico.nome);assert.deepEqual(obs.pendencias, []);
  for (const protegido of Object.keys(camposProtegidos)) assert.equal(protegido in obs.campos, false);
  for (const operacao of ["CRIAR", "ATUALIZAR"] as const) {
    const payload = prepararPayload("SERVICO", { ...obs.campos, ...camposProtegidos }, { operacao });
    assert.equal(payload.codigo, servico.codigo);assert.equal(payload.nome, servico.nome);
    assert.equal(payload.unidade, "UN");assert.equal(payload.descricaoComplementar, "Bordado até 20 cm");
    for (const protegido of Object.keys(camposProtegidos)) assert.equal(protegido in payload, false);
  }
  const semCodigo = observarRegistro("SERVICO", { ...servico, codigo: null }, { completo: true });
  assert.equal(semCodigo.chave, "nome:bordado industrial");
  assert.equal(prepararPayload("SERVICO", semCodigo.campos, { operacao: "CRIAR" }).codigo, null);
});

test("comparação de serviços ignora diferenças somente em preço e fiscal e bloqueia inativos", () => {
  const observar = (id: number, campos: Record<string, unknown> = {}) => observarRegistro("SERVICO", { ...servico, id, ...campos }, { completo: true });
  const replicas: ReplicaComparacao[] = [{ aplicativoId: "a", observacao: observar(10, { preco: 10 }) }, { aplicativoId: "b", observacao: observar(20, { preco: 99, nbs: "999" }) }];
  const avaliar = (itens: ReplicaComparacao[]) => avaliarReplicas({ entidade: "SERVICO", replicas: itens, hashesBase: null, visaoCompleta: true, hash: serializarCanonico });
  assert.equal(avaliar(replicas).status, "SINCRONIZADO");
  const criar = avaliar([replicas[0], { aplicativoId: "b", observacao: null }]);
  assert.equal(criar.status, "PROPAGAR");assert.deepEqual(criar.aplicativosCriar, ["b"]);
  for (const situacao of ["I", "E"]) {
    const resultado = avaliar([{ aplicativoId: "a", observacao: observar(10, { situacao }) }, { aplicativoId: "b", observacao: null }]);
    assert.equal(resultado.status, "AGUARDANDO_REVISAO");assert.ok(resultado.motivos.includes("REGISTRO_INATIVO"));
  }
});

test("cliente lista e detalha serviços com paginação limitada e sem filtro incremental inventado", async () => {
  const m = mock([{ status: 200, dados: pagina([servico]) }, { status: 200, dados: servico }]);
  const lista = await m.cliente.listar("a", "SERVICO", { offset: 0, limit: 100 });
  assert.equal(lista.itens[0].chave, "codigo:001-Ab");
  assert.equal(lista.itens[0].completo, true, "A listagem usa o mesmo modelo completo do detalhe");
  const url = new URL(m.chamadas[0].url);assert.ok(url.pathname.endsWith("/servicos"));
  assert.equal(url.searchParams.get("limit"), "100");assert.equal(url.searchParams.get("offset"), "0");
  assert.equal((await m.cliente.detalhar("a", "SERVICO", "10")).completo, true);
  assert.ok(m.chamadas[1].url.endsWith("/servicos/10"));
  const antes = m.chamadas.length;
  await assert.rejects(m.cliente.listar("a", "SERVICO", { offset: 0, limit: 100, desde: "2026-01-01", incrementalValidado: true }), FalhaSync);
  assert.equal(m.chamadas.length, antes);
});

test("busca de serviços consulta código exato e não aceita similaridade de código", async () => {
  const m = mock([{ status: 200, dados: pagina([servico, { ...servico, id: 20, codigo: "001-ab" }]) }]);
  assert.deepEqual((await m.cliente.buscarPorChave("a", "SERVICO", "codigo:001-Ab")).map(o => o.id), ["10"]);
  const url = new URL(m.chamadas[0].url);assert.equal(url.searchParams.get("codigo"), "001-Ab");
  assert.equal(url.searchParams.has("nome"), false);
});

test("busca por nome sem código usa igualdade normalizada e bloqueia código preenchido e truncamento", async () => {
  const m = mock([{ status: 200, dados: pagina([{ ...servico, codigo: null, nome: "  BORDADO   Industrial " }, { ...servico, id: 30, codigo: null, nome: "Bordado industrial extra" }]) }]);
  const resultado = await m.cliente.buscarPorChave("a", "SERVICO", "nome:bordado industrial");
  assert.deepEqual(resultado.map(o => o.id), ["10"]);
  assert.equal(new URL(m.chamadas[0].url).searchParams.get("nome"), "bordado industrial");
  for (const dados of [pagina([servico]), pagina([{ ...servico, codigo: null }], 101)]) {
    const bloqueado = mock([{ status: 200, dados }]);
    await assert.rejects(bloqueado.cliente.buscarPorChave("a", "SERVICO", "nome:bordado industrial"), FalhaSync);
  }
  const omitido = mock([{ status: 200, dados: pagina([{ id: 20, nome: servico.nome, situacao: "A" }]) }]);
  assert.deepEqual((await omitido.cliente.buscarPorChave("a", "SERVICO", "nome:bordado industrial")).map(o => o.id), ["20"]);
  const espacos = mock([{ status: 200, dados: { cpfCnpj: "04252011000110", razaoSocial: "Conta" } }, { status: 200, dados: pagina([{ ...servico, codigo: null }]) }]);
  await espacos.cliente.buscarPorChave("a", "SERVICO", "nome:bordado industrial", { validarConta: () => true, nomeServico: "  Ｂordado   Industrial " });
  assert.equal(new URL(espacos.chamadas.at(-1)!.url).searchParams.get("nome"), "Bordado Industrial");
});

test("nome de serviço curto, numérico ou com asterisco não recebe regra de anonimização de contatos", () => {
  for (const nome of ["X", "123", "*"]) for (const codigo of [null, "001-Ab"]) {
    const obs = observarRegistro("SERVICO", { ...servico, nome, codigo }, { completo: true });
    assert.equal(obs.chave, codigo === null ? `nome:${nome.toLocaleLowerCase("pt-BR")}` : `codigo:${codigo}`);
    assert.deepEqual(obs.pendencias, []);
    assert.equal(prepararPayload("SERVICO", obs.campos, { operacao: "CRIAR" }).nome, nome);
  }
});

test("sonda de criação ignora outros códigos e conserva código esperado e serviços sem código", async () => {
  const conta = { status: 200, dados: { cpfCnpj: "04252011000110", razaoSocial: "Conta" } };
  const itens = [servico, { ...servico, id: 20, codigo: "002" }, { ...servico, id: 30, codigo: null }];
  const m = mock([conta, { status: 200, dados: pagina(itens) }]);
  const encontrados = await m.cliente.buscarPorChave("a", "SERVICO", "nome:bordado industrial", { validarConta: () => true, codigoServicoReferencia: "001-Ab" });
  assert.deepEqual(encontrados.map(s => s.id), ["10", "30"]);
  const outro = mock([conta, { status: 200, dados: pagina([{ ...servico, id: 20, codigo: "002" }]) }]);
  assert.deepEqual(await outro.cliente.buscarPorChave("a", "SERVICO", "nome:bordado industrial", { validarConta: () => true, codigoServicoReferencia: "001-Ab" }), []);
});

test("POST e PUT de serviços usam endpoints próprios e removem preço, fiscal e IDs da origem", async () => {
  for (const atualizar of [false, true]) {
    const m = mock([{ status: atualizar ? 204 : 200, dados: { id: 20 } }]);
    const campos = { ...servico, preco: 99, nbs: "123", tipoItemSped: "09", codigoListaServicos: "0101" };
    const resultado = atualizar ? await m.cliente.atualizar("a", "SERVICO", "20", campos) : await m.cliente.criar("a", "SERVICO", campos);
    assert.equal(resultado.id, "20");assert.equal(m.chamadas.length, 1);
    assert.equal(m.chamadas[0].metodo, atualizar ? "PUT" : "POST");
    assert.ok(new URL(m.chamadas[0].url).pathname.endsWith(atualizar ? "/servicos/20" : "/servicos"));
    const payload = m.chamadas[0].payload;
    assert.ok(payload && !Array.isArray(payload) && typeof payload === "object");
    for (const campo of ["id", "preco", "nbs", "tipoItemSped", "codigoListaServicos"]) assert.equal(campo in payload, false);
  }
});
