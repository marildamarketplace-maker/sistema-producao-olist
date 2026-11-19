import assert from "node:assert/strict";
import test from "node:test";
import { FalhaSync, type CamposSync, type ReplicaComparacao } from "../src/lib/olist-sync/contrato";
import { criarCriptografiaSync, serializarCanonico } from "../src/lib/olist-sync/cripto";
import {
  avaliarReplicas, gerarHashesCampos, identificadorRemoto, inferirOrigem, normalizarDocumento,
  observarRegistro, prepararImagens, prepararPayload, prepararVariacao, similaridadeNomes,
} from "../src/lib/olist-sync/dominio";

const chaves = { OLIST_SYNC_DATA_KEY: Buffer.alloc(32, 1).toString("base64"), OLIST_SYNC_HMAC_KEY: Buffer.alloc(32, 2).toString("base64") };
const cripto = criarCriptografiaSync(chaves);
const hash = (valor: Parameters<typeof cripto.hash>[0]) => cripto.hash(valor, "grupo-teste");
const produto = (campos: Record<string, unknown> = {}) => observarRegistro("PRODUTO", {
  id: 123, sku: "001-a", descricao: "Toalha floral", tipo: "S", situacao: "A", unidade: "UN", ...campos,
}, { completo: true });
const replica = (aplicativoId: string, campos: Record<string, unknown> = {}): ReplicaComparacao => ({ aplicativoId, observacao: produto(campos) });
const avaliar = (replicas: ReplicaComparacao[], hashesBase: Record<string, string> | null = null, visaoCompleta = true) => avaliarReplicas({ entidade: "PRODUTO", replicas, hashesBase, visaoCompleta, hash });

test("CPF/CNPJ confiáveis preservam zeros e validam os dígitos, inclusive CNPJ alfanumérico", () => {
  assert.equal(normalizarDocumento("529.982.247-25"), "52998224725");
  assert.equal(normalizarDocumento("04.252.011/0001-10"), "04252011000110");
  // Exemplo oficial da Receita/Serpro: manual-dv-cnpj.pdf.
  assert.equal(normalizarDocumento("12.abc.345/01de-35"), "12ABC34501DE35");
  for (const documento of ["", "11111111111", "00000000000000", "529.982.247-26", "12.ABC.345/01DE-36", "abc@12ABC34501DE35", 52998224725]) {
    assert.equal(normalizarDocumento(documento), null);
  }
});

test("SKU é exato, preserva zeros, letras e espaços; nomes não criam identidade", () => {
  assert.equal(produto({ sku: " 001-Ab " }).chave, " 001-Ab ");
  assert.equal(produto({ sku: "" }).chave, null);
  assert.equal(observarRegistro("FORMA_PAGAMENTO", { id: 1, nome: "Pix", situacao: 1 }, { completo: true }).chave, null);
  assert.ok(similaridadeNomes("Toalha de Mesa Florál", "toalha de mesa floral") >= 0.85);
  assert.equal(similaridadeNomes("", ""), 0);
});

test("observação e payload excluem estoque, preços, custo, fiscal e IDs internos", () => {
  const obs = produto({
    estoque: { saldo: 60, inicial: 50 }, precos: { preco: 90, precoCusto: 11 }, custos: { custoMedio: 1 },
    ncm: "123", origem: 0, tributacao: { valorIPIFixo: 1 }, idCategoria: 44,
    dimensoes: { pesoLiquido: 1, embalagem: { id: 99, tipo: 2 } },
  });
  const payload = prepararPayload("PRODUTO", obs.campos, { operacao: "CRIAR" });
  const json = JSON.stringify(payload);
  for (const campo of ["estoque", "precos", "custos", "ncm", "origem", "tributacao", "idCategoria", '"id"']) assert.equal(json.includes(campo), false);
  assert.deepEqual(payload.dimensoes, { largura: null, altura: null, comprimento: null, diametro: null, pesoLiquido: 1, pesoBruto: null, embalagem: { tipo: 2 } });
  assert.equal(payload.tipo, "S");
  assert.equal(prepararPayload("PRODUTO", obs.campos, { operacao: "ATUALIZAR" }).tipo, undefined);
});

test("listagem não é suficiente para estabelecer uma base", () => {
  const resumo = observarRegistro("PRODUTO", { id: 1, sku: "001-a", descricao: "Toalha floral", tipo: "S", situacao: "A" });
  assert.equal(resumo.completo, false);
  assert.equal("garantia" in resumo.campos, false);
  assert.ok(avaliar([{ aplicativoId: "a", observacao: resumo }, replica("b")]).motivos.includes("AUDITORIA_INCOMPLETA"));
});

test("réplicas equivalentes iniciam base sem escrita e sem escolher origem histórica", () => {
  const replicas = [replica("a"), replica("b"), replica("c")];
  const decisao = avaliar(replicas);
  assert.equal(decisao.status, "SINCRONIZADO");
  assert.deepEqual(decisao.aplicativosAtualizar, []);
  assert.deepEqual(inferirOrigem(replicas, true), { tipo: "DESCONHECIDA", aplicativoId: null });
});

test("origem única só é observada após visão completa e nunca substitui origem existente", () => {
  const replicas = [replica("a"), { aplicativoId: "b", observacao: null }];
  assert.equal(inferirOrigem(replicas, false).tipo, "DESCONHECIDA");
  assert.deepEqual(inferirOrigem(replicas, true), { tipo: "OBSERVADA_PELO_MODULO", aplicativoId: "a" });
  assert.deepEqual(inferirOrigem(replicas, true, { tipo: "DECLARADA_POR_USUARIO", aplicativoId: "b" }), { tipo: "DECLARADA_POR_USUARIO", aplicativoId: "b" });
  assert.deepEqual(inferirOrigem(replicas, true, { tipo: "DESCONHECIDA", aplicativoId: null }), { tipo: "DESCONHECIDA", aplicativoId: null });
});

test("divergência inicial requer revisão sem usar data ou ordem como vencedor", () => {
  const decisao = avaliar([replica("a", { descricao: "Versão antiga", dataAlteracao: "2020-01-01" }), replica("b", { descricao: "Versão nova", dataAlteracao: "2030-01-01" })]);
  assert.equal(decisao.status, "AGUARDANDO_REVISAO");
  assert.ok(decisao.motivos.includes("DIVERGENCIA_INICIAL:descricao"));
});

test("alteração unilateral com base aceita propaga para N réplicas", () => {
  const base = gerarHashesCampos(produto().campos, hash);
  const decisao = avaliar([replica("a", { descricao: "Nova descrição" }), replica("b"), replica("c")], base);
  assert.equal(decisao.status, "PROPAGAR");
  assert.equal(decisao.campos?.descricao, "Nova descrição");
  assert.deepEqual(decisao.aplicativosAtualizar, ["b", "c"]);
  assert.deepEqual(decisao.fontesPorCampo.descricao, ["a"]);
});

test("edições independentes de campos podem convergir com origem por campo", () => {
  const decisao = avaliar([replica("a", { descricao: "Nova descrição" }), replica("b", { garantia: "12 meses" }), replica("c")], gerarHashesCampos(produto().campos, hash));
  assert.equal(decisao.status, "PROPAGAR");
  assert.equal(decisao.campos?.descricao, "Nova descrição");
  assert.equal(decisao.campos?.garantia, "12 meses");
  assert.deepEqual(decisao.fontesPorCampo.descricao, ["a"]);
  assert.deepEqual(decisao.fontesPorCampo.garantia, ["b"]);
  assert.deepEqual(decisao.aplicativosAtualizar, ["a", "b", "c"]);
});

test("mesma alteração simultânea converge; alterações divergentes conflitam", () => {
  const base = gerarHashesCampos(produto().campos, hash);
  assert.equal(avaliar([replica("a", { garantia: "1 ano" }), replica("b", { garantia: "1 ano" }), replica("c")], base).status, "PROPAGAR");
  assert.ok(avaliar([replica("a", { garantia: "1 ano" }), replica("b", { garantia: "2 anos" }), replica("c")], base).motivos.includes("CONFLITO:garantia"));
});

test("identidade, unidade e GTIN preenchido não são alterados automaticamente", () => {
  for (const campo of ["sku", "unidade", "tipo"] as const) {
    const decisao = avaliar([replica("a", { [campo]: campo === "tipo" ? "M" : "OUTRO" }), replica("b")], gerarHashesCampos(produto().campos, hash));
    assert.equal(decisao.status, "AGUARDANDO_REVISAO");
  }
  const base = gerarHashesCampos(produto({ gtin: "7891111111111" }).campos, hash);
  assert.ok(avaliar([replica("a", { gtin: "7892222222222" }), replica("b", { gtin: "7891111111111" })], base).motivos.includes("CAMPO_PROTEGIDO:gtin"));
  assert.equal(avaliar([replica("a", { gtin: "7892222222222" }), replica("b")], gerarHashesCampos(produto().campos, hash)).status, "PROPAGAR");
});

test("inativos, removidos conhecidos, identidade diferente e réplica repetida bloqueiam", () => {
  assert.ok(avaliar([replica("a", { situacao: "I" }), replica("b")]).motivos.includes("REGISTRO_INATIVO"));
  assert.ok(avaliar([replica("a"), { aplicativoId: "b", observacao: null, existia: true }]).motivos.includes("REGISTRO_REMOVIDO"));
  assert.ok(avaliar([replica("a"), replica("b", { sku: "001-A" })]).motivos.includes("IDENTIDADE_REQUER_REVISAO"));
  assert.ok(avaliar([replica("a"), replica("a")]).motivos.includes("REPLICA_DUPLICADA"));
});

test("novo destino cria após auditoria completa; referências e imagens pendentes bloqueiam criação", () => {
  const destino = { aplicativoId: "b", observacao: null };
  const decisao = avaliar([replica("a"), destino]);
  assert.deepEqual(decisao.aplicativosCriar, ["b"]);
  assert.equal(decisao.status, "PROPAGAR");
  assert.equal(avaliar([replica("a"), destino], null, false).status, "AGUARDANDO_REVISAO");
  assert.ok(avaliar([replica("a", { marca: { id: 2 } }), destino]).motivos.includes("REFERENCIA_MARCA"));
  assert.ok(avaliar([replica("a", { anexos: [{ url: "https://cdn.example.com/foto.jpg", externo: true }] }), destino]).motivos.includes("IMAGENS_REQUEREM_VALIDACAO"));
});

test("mudanças apenas em estoque, preço e fiscal não geram atualização", () => {
  const decisao = avaliar([replica("a", { estoque: { saldo: 100 }, precos: { preco: 5 }, ncm: "123" }), replica("b", { estoque: { saldo: -10 }, precos: { preco: 500 }, ncm: "456" })]);
  assert.equal(decisao.status, "SINCRONIZADO");
});

test("diferenças de imagens são auditadas e nunca viram PUT comum silenciosamente", () => {
  const anexos = [{ id: 1, url: "https://cdn.example.com/foto.jpg", externo: true }];
  const inicial = avaliar([replica("a", { anexos }), replica("b")]);
  assert.ok(inicial.motivos.includes("DIVERGENCIA_INICIAL:imagens"));
  const posterior = avaliar([replica("a", { anexos }), replica("b")], gerarHashesCampos(produto().campos, hash));
  assert.ok(posterior.motivos.includes("SUBRECURSO_REQUER_VALIDACAO:imagens"));
  assert.deepEqual(produto({ anexos }).campos.imagens, [{ url: "https://cdn.example.com/foto.jpg", externo: true }]);
  assert.throws(() => prepararPayload("PRODUTO", produto({ anexos }).campos, { operacao: "CRIAR" }), FalhaSync);
});

test("endereços são grupos atômicos e não mesclam partes conflitantes", () => {
  const contato = (endereco: CamposSync) => observarRegistro("CONTATO", { id: 10, nome: "Contato", cpfCnpj: "52998224725", tipoPessoa: "F", situacao: "B", endereco }, { completo: true });
  const inicial = contato({ endereco: "Rua A", numero: "1" });
  const decisao = avaliarReplicas({ entidade: "CONTATO", replicas: [{ aplicativoId: "a", observacao: contato({ endereco: "Rua B", numero: "1" }) }, { aplicativoId: "b", observacao: contato({ endereco: "Rua A", numero: "2" }) }], hashesBase: gerarHashesCampos(inicial.campos, hash), visaoCompleta: true, hash });
  assert.ok(decisao.motivos.includes("CONFLITO:endereco"));
});

test("cobrança ausente equivale somente ao endereço vazio com país padrão da Olist", () => {
  const contato = (enderecoCobranca: CamposSync["enderecoCobranca"]) => observarRegistro("CONTATO", {
    id: 10, nome: "Contato", cpfCnpj: "52998224725", tipoPessoa: "F", situacao: "B", enderecoCobranca,
  }, { completo: true });
  const origem = contato(null);
  const vazios: CamposSync[] = [{}, { pais: "Brasil" }, { pais: "Brasil", endereco: "", numero: null, complemento: "" }];
  for (const endereco of vazios) {
    const destino = contato(endereco);
    assert.deepEqual(gerarHashesCampos(origem.campos, hash), gerarHashesCampos(destino.campos, hash));
    const decisao = avaliarReplicas({ entidade: "CONTATO", replicas: [{ aplicativoId: "a", observacao: origem }, { aplicativoId: "b", observacao: destino }], hashesBase: null, visaoCompleta: true, hash });
    assert.equal(decisao.status, "SINCRONIZADO");assert.deepEqual(decisao.aplicativosAtualizar, []);
    assert.notEqual(destino.campos.enderecoCobranca, null, "A comparação não deve descartar o snapshot original");
  }
  const preenchidos: CamposSync[] = [{ pais: "Portugal" }, { pais: "Brasil", numero: "0" }, { pais: "Brasil", cep: "12345678" }, { pais: "Brasil", endereco: "Rua A" }];
  for (const endereco of preenchidos) {
    const destino = contato(endereco);
    assert.notEqual(gerarHashesCampos(origem.campos, hash).enderecoCobranca, gerarHashesCampos(destino.campos, hash).enderecoCobranca);
    assert.equal(avaliarReplicas({ entidade: "CONTATO", replicas: [{ aplicativoId: "a", observacao: origem }, { aplicativoId: "b", observacao: destino }], hashesBase: null, visaoCompleta: true, hash }).status, "AGUARDANDO_REVISAO");
  }
});

test("contatos não transferem acesso ao sistema, crédito, fiscal ou dados pessoais fora do escopo", () => {
  const obs = observarRegistro("CONTATO", { id: 10, nome: "Contato", cpfCnpj: "529.982.247-25", tipoPessoa: "F", situacao: "A", limiteCredito: 1000, dataNascimento: "2000-01-01", senha: "segredo", vendedor: { id: 123 } }, { completo: true });
  assert.equal(obs.situacao, "B");
  const payload = prepararPayload("CONTATO", obs.campos, { operacao: "CRIAR" });
  assert.equal(payload.situacao, "B");
  for (const campo of ["limiteCredito", "dataNascimento", "senha", "vendedor"]) assert.equal(campo in payload, false);
  assert.throws(() => prepararPayload("CONTATO", { ...obs.campos, tipoPessoa: "J" }, { operacao: "CRIAR" }), FalhaSync);
});

test("somente leitura e estruturas complexas não escapam pela construção do payload", () => {
  for (const entidade of ["FORMA_PAGAMENTO", "VENDEDOR"] as const) assert.throws(() => prepararPayload(entidade, { nome: "teste" }, { operacao: "CRIAR" }), FalhaSync);
  for (const tipo of ["K", "F", "V"]) assert.throws(() => prepararPayload("PRODUTO", { sku: "A", descricao: "B", tipo }, { operacao: "CRIAR" }), FalhaSync);
  assert.throws(() => prepararPayload("PRODUTO", { sku: "A", descricao: "B", tipo: "S", tipoVariacao: "V" }, { operacao: "ATUALIZAR" }), FalhaSync);
});

test("imagens e variações exigem contrato validado e removem IDs/estoque/preços", () => {
  const imagem = [{ url: "https://cdn.example.com/a.jpg", externo: true, id: 13 }];
  assert.throws(() => prepararImagens(imagem, false), FalhaSync);
  assert.deepEqual(prepararImagens(imagem, true), [{ url: "https://cdn.example.com/a.jpg", externo: true }]);
  for (const url of ["http://cdn.example.com/a.jpg", "https://127.0.0.1/a", "https://localhost/a", "https://user:pass@cdn.example.com/a", "file:///tmp/a"]) assert.throws(() => prepararImagens([{ url, externo: true }], true), FalhaSync);
  const variacao = { sku: "001-A", grade: [{ chave: "Cor", valor: "Azul", id: 7 }], estoque: { inicial: 100 }, precos: { preco: 999 } };
  assert.throws(() => prepararVariacao(variacao, false), FalhaSync);
  assert.deepEqual(prepararVariacao(variacao, true), { sku: "001-A", grade: [{ chave: "Cor", valor: "Azul" }] });
});

test("identificadores não aceitam valores imprecisos nem interpolação de caminhos", () => {
  assert.equal(identificadorRemoto("9007199254740993"), "9007199254740993");
  for (const valor of [9007199254740992, "../info", 0, -1, 1.5, "12?token=secret"]) assert.throws(() => identificadorRemoto(valor), FalhaSync);
});

test("HMAC é estável e separado por grupo; dados cifrados não revelam o documento", () => {
  assert.equal(hash({ a: 1, b: 2 }), hash({ b: 2, a: 1 }));
  assert.notEqual(cripto.hash("52998224725", "grupo-a"), cripto.hash("52998224725", "grupo-b"));
  const dados = { cpfCnpj: "52998224725", nome: "Contato" };
  const a = cripto.cifrar(dados, "grupo-a:registro1");
  const b = cripto.cifrar(dados, "grupo-a:registro1");
  assert.notEqual(a, b);
  assert.equal(a.includes("52998224725"), false);
  assert.deepEqual(cripto.decifrar(a, "grupo-a:registro1"), dados);
  assert.throws(() => cripto.decifrar(a, "grupo-b:registro1"), FalhaSync);
  const partes = a.split(".");
  partes[3] = (partes[3][0] === "A" ? "B" : "A") + partes[3].slice(1);
  assert.throws(() => cripto.decifrar(partes.join("."), "grupo-a:registro1"), FalhaSync);
});

test("configuração criptográfica falha fechada e rejeita JSON não canônico", () => {
  for (const env of [{}, { ...chaves, OLIST_SYNC_DATA_KEY: "segredo-curto" }, { ...chaves, OLIST_SYNC_HMAC_KEY: chaves.OLIST_SYNC_DATA_KEY }]) assert.throws(() => criarCriptografiaSync(env), FalhaSync);
  assert.throws(() => cripto.hash("valor", ""), FalhaSync);
  assert.throws(() => serializarCanonico({ numero: Number.NaN }), FalhaSync);
  assert.throws(() => serializarCanonico({ numero: Number.POSITIVE_INFINITY }), FalhaSync);
  assert.notEqual(hash([1, 2]), hash([2, 1]));
});

test("merge com três empresas não depende da ordem das réplicas", () => {
  const a = replica("a", { descricao: "Descrição nova" });
  const b = replica("b", { garantia: "Garantia nova" });
  const c = replica("c");
  const base = gerarHashesCampos(produto().campos, hash);
  const ordens = [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]];
  for (const ordem of ordens) {
    const decisao = avaliar(ordem, base);
    assert.equal(decisao.status, "PROPAGAR");
    assert.equal(decisao.campos?.descricao, "Descrição nova");
    assert.equal(decisao.campos?.garantia, "Garantia nova");
    assert.deepEqual(decisao.fontesPorCampo.descricao, ["a"]);
    assert.deepEqual(decisao.fontesPorCampo.garantia, ["b"]);
    assert.deepEqual([...decisao.aplicativosAtualizar].sort(), ["a", "b", "c"]);
  }
});

test("conflito concorrente bloqueia também criação em uma terceira empresa", () => {
  const decisao = avaliar([
    replica("a", { descricao: "Escolha A" }),
    replica("b", { descricao: "Escolha B" }),
    { aplicativoId: "c", observacao: null },
  ], gerarHashesCampos(produto().campos, hash));
  assert.equal(decisao.status, "AGUARDANDO_REVISAO");
  assert.ok(decisao.motivos.includes("CONFLITO:descricao"));
  assert.equal(decisao.campos, null);
  assert.deepEqual(decisao.aplicativosCriar, []);
  assert.deepEqual(decisao.aplicativosAtualizar, []);
});

test("ausência de todas as réplicas ou grupo de uma empresa não autoriza propagação", () => {
  for (const replicas of [[], [replica("a")], [{ aplicativoId: "a", observacao: null }, { aplicativoId: "b", observacao: null }]]) {
    const decisao = avaliar(replicas);
    assert.equal(decisao.status, "AGUARDANDO_REVISAO");
    assert.deepEqual(decisao.aplicativosCriar, []);
  }
});

test("vinte empresas equivalentes geram uma base comum sem operações por par", () => {
  const replicas = Array.from({ length: 20 }, (_, indice) => replica(`filho-${indice}`));
  const decisao = avaliar(replicas);
  assert.equal(decisao.status, "SINCRONIZADO");
  assert.deepEqual(decisao.aplicativosCriar, []);
  assert.deepEqual(decisao.aplicativosAtualizar, []);
  assert.deepEqual(decisao.hashes, gerarHashesCampos(produto().campos, hash));
  assert.equal(inferirOrigem(replicas, true).tipo, "DESCONHECIDA");
});

test("remoção explícita de um texto opcional propaga null sem recuperar o valor antigo", () => {
  const base = gerarHashesCampos(produto({ garantia: "Texto anterior" }).campos, hash);
  const decisao = avaliar([replica("a", { garantia: null }), replica("b", { garantia: "Texto anterior" })], base);
  assert.equal(decisao.status, "PROPAGAR");
  assert.equal(decisao.campos?.garantia, null);
  assert.deepEqual(decisao.aplicativosAtualizar, ["b"]);
  assert.equal(prepararPayload("PRODUTO", decisao.campos!, { operacao: "ATUALIZAR" }).garantia, null);
});

test("campo ausente em uma réplica não é confundido com limpeza explícita", () => {
  const incompleta = produto();
  delete incompleta.campos.garantia;
  const decisao = avaliar([{ aplicativoId: "a", observacao: incompleta }, replica("b")], gerarHashesCampos(produto().campos, hash));
  assert.equal(decisao.status, "AGUARDANDO_REVISAO");
  assert.ok(decisao.motivos.includes("CAMPO_INCOMPLETO:garantia"));
  assert.deepEqual(decisao.aplicativosAtualizar, []);
});

test("projeção e preparação de payload não modificam o cadastro recebido", () => {
  const entrada = { id: 123, sku: "001-a", descricao: "Produto", tipo: "S", situacao: "A",
    dimensoes: { pesoBruto: 2, embalagem: { id: 99, tipo: 2 } }, estoque: { saldo: 73 } };
  const antes = structuredClone(entrada);
  const observacao = observarRegistro("PRODUTO", entrada, { completo: true });
  const payload = prepararPayload("PRODUTO", observacao.campos, { operacao: "ATUALIZAR" });
  assert.deepEqual(entrada, antes);
  payload.descricao = "Alteração isolada";
  assert.equal(observacao.campos.descricao, "Produto");
  assert.equal(entrada.dimensoes.embalagem.id, 99);
});

test("estado cifrado não pode ser transplantado entre conta, entidade, registro ou operação", () => {
  const contexto = "grupo:estado:filho-a:CONTATO:123";
  const dados = { nome: "Contato fictício", cpfCnpj: "52998224725" };
  const cifra = cripto.cifrar(dados, contexto);
  for (const outro of ["grupo:estado:filho-b:CONTATO:123", "grupo:estado:filho-a:VENDEDOR:123", "grupo:estado:filho-a:CONTATO:456", "grupo:operacao:123"]) {
    assert.throws(() => cripto.decifrar(cifra, outro), erro => erro instanceof FalhaSync && erro.codigo === "DADOS_INVALIDOS");
  }
  assert.deepEqual(cripto.decifrar(cifra, contexto), dados);
});

test("cifra rejeita versão, nonce, tag e formato adulterados sem expor o conteúdo", () => {
  const original = cripto.cifrar({ segredo: "dado-ficticio-nao-publico" }, "contexto");
  const partes = original.split(".");
  const invalidos = [original.replace(/^v1/, "v2"), partes.slice(0, 3).join("."), `${original}.extra`,
    [partes[0], "AA", partes[2], partes[3]].join("."), [partes[0], partes[1], "AA", partes[3]].join(".")];
  for (const invalido of invalidos) assert.throws(() => cripto.decifrar(invalido, "contexto"), erro =>
    erro instanceof FalhaSync && erro.codigo === "DADOS_INVALIDOS" && !erro.message.includes("dado-ficticio-nao-publico"));
});

test("limite de conteúdo protegido considera bytes UTF-8 e profundidade", () => {
  const limite = 2 * 1024 * 1024;
  const permitido = "é".repeat((limite - 2) / 2);
  assert.equal(Buffer.byteLength(serializarCanonico(permitido), "utf8"), limite);
  assert.throws(() => serializarCanonico(`${permitido}é`), erro => erro instanceof FalhaSync && erro.codigo === "JSON_INVALIDO");
  let profundo: CamposSync = {};
  for (let nivel = 0; nivel < 34; nivel++) profundo = { filho: profundo };
  assert.throws(() => serializarCanonico(profundo), erro => erro instanceof FalhaSync && erro.codigo === "JSON_INVALIDO");
});
