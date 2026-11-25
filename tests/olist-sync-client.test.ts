import assert from "node:assert/strict";
import test from "node:test";
import { FalhaSync } from "../src/lib/olist-sync/contrato";
import { criarClienteSync, retryAfterSync, type DependenciasClienteSync, type RequisicaoSync, type RespostaHttpSync } from "../src/lib/olist-sync/cliente";

const produto = { id: 100, sku: "001-a", descricao: "Ref Toalha", tipo: "S", situacao: "A" };
const pagina = (itens: unknown[] = [produto], total = itens.length) => ({ itens, paginacao: { total, offset: 0, limit: 100 } });
const falha = (codigo: string, inconclusivo?: boolean) => (erro: unknown) => erro instanceof FalhaSync && erro.codigo === codigo && (inconclusivo === undefined || erro.inconclusivo === inconclusivo);

test("documento de contato sem DV válido chega à busca, POST e PUT sem alteração dos dígitos",async()=>{
  const cpfCnpj="52998224726";
  const busca=mock([{status:200,dados:pagina([{id:10,nome:"Contato",cpfCnpj}])}]);
  assert.deepEqual((await busca.cliente.buscarPorChave("a","CONTATO","529.982.247-26")).map(item=>item.id),["10"]);
  assert.equal(new URL(busca.chamadas[0].url).searchParams.get("cpfCnpj"),cpfCnpj);
  for(const atualizar of [false,true]) {
    const m=mock([{status:200,dados:{cpfCnpj:"04252011000110",razaoSocial:"Conta"}},{status:200,dados:{id:10}}]);
    const campos={nome:"Contato",cpfCnpj:"529.982.247-26",tipoPessoa:"F"};
    if(atualizar)await m.cliente.atualizar("a","CONTATO","10",campos,{validarConta:()=>true});
    else await m.cliente.criar("a","CONTATO",campos,{validarConta:()=>true});
    assert.equal((m.chamadas[1].payload as Record<string,unknown>).cpfCnpj,cpfCnpj);
  }
  const rejeitada=mock([{status:400,dados:{mensagem:"documento rejeitado"}}]);
  await assert.rejects(rejeitada.cliente.criar("a","CONTATO",{nome:"Contato",cpfCnpj,tipoPessoa:"F"}),falha("OLIST_400",false));
  assert.equal(rejeitada.chamadas.length,1);
});

test("busca por nome completo usa filtro limitado e igualdade exata, preservando homônimos",async()=>{
  const m=mock([{status:200,dados:pagina([
    {id:10,nome:"Éva Santos",cpfCnpj:null},
    {id:20,nome:"  ÉVA   SANTOS ",cpfCnpj:""},
    {id:30,nome:"Éva Santos Silva",cpfCnpj:null},
  ])}]);
  const encontrados=await m.cliente.buscarPorChave("a","CONTATO","nome:éva santos");
  assert.deepEqual(encontrados.map(o=>o.id),["10","20"]);
  const url=new URL(m.chamadas[0].url);assert.equal(url.searchParams.get("nome"),"éva santos");
  assert.equal(url.searchParams.has("cpfCnpj"),false);assert.equal(url.searchParams.get("limit"),"100");
});

test("busca por nome completo não repete consulta ampla após timeout 400",async()=>{
  const m=mock([{status:400,dados:{mensagem:"Sua consulta levou muito tempo. Por favor, ajuste seus filtros ou tente novamente mais tarde."}}]);
  await assert.rejects(m.cliente.buscarPorChave("a","CONTATO","nome:eva do pilar santos melo"),erro=>
    erro instanceof FalhaSync && erro.codigo==="OLIST_400" && erro.origemConsulta==="RECURSO" && !erro.recuperavel && !erro.inconclusivo);
  assert.equal(m.chamadas.length,1);
  assert.equal(new URL(m.chamadas[0].url).searchParams.get("nome"),"eva do pilar santos melo");
});

test("origem da consulta separa erro de info de erro no cadastro sem expor resposta",async()=>{
  for(const protegida of [false,true]) {
    const m=mock([{status:400,dados:{mensagem:"corpo privado"}}]);
    const consulta=()=>protegida?m.cliente.buscarPorChave("a","CONTATO","nome:eva santos",{validarConta:()=>true}):m.cliente.identidadeConta("a");
    await assert.rejects(consulta,erro=>erro instanceof FalhaSync && erro.origemConsulta==="CONTA" && erro.codigo==="OLIST_400" && !erro.message.includes("privado"));
    assert.equal(m.chamadas.length,1);assert.ok(m.chamadas[0].url.endsWith("/info"));
  }
});

test("busca por nome não comprova ausência com documento preenchido, omitido ou resultado truncado",async()=>{
  for(const campos of [{cpfCnpj:"52998224725"},{cpfCnpj:"invalido"},{}]) {
    const m=mock([{status:200,dados:pagina([{id:10,nome:"Eva Santos",...campos}])}]);
    await assert.rejects(m.cliente.buscarPorChave("a","CONTATO","nome:eva santos"),falha("IDENTIDADE_INCOMPATIVEL"));
  }
  const truncada=mock([{status:200,dados:pagina([{id:10,nome:"Eva Santos",cpfCnpj:null}],101)}]);
  await assert.rejects(truncada.cliente.buscarPorChave("a","CONTATO","nome:eva santos"),falha("BUSCA_TRUNCADA"));
  const invalida=mock([]);await assert.rejects(invalida.cliente.buscarPorChave("a","CONTATO","nome:J******e"),falha("IDENTIDADE_INVALIDA"));assert.equal(invalida.chamadas.length,0);
});

test("catálogo de tipos usa paginação limitada, identidade protegida e headers de cota", async () => {
  const m = mock([{ status: 200, dados: { cpfCnpj: "52998224725", razaoSocial: "Conta" } },
    { status: 200, dados: pagina([{ id: 87, nome: "Cliente", perfilContato: 0 }]), cotaLeitura: { limite: 60, restante: 59, resetSegundos: 10 } }]);
  let guard = 0;
  const resposta = await m.cliente.listarTiposContato!("b", { offset: 0, limit: 100 }, { validarConta: conta => conta.documento === "52998224725", antesDeConsultar: async () => { guard++; } });
  assert.equal(guard, 1);assert.equal(resposta.itens[0].id, "87");assert.equal(resposta.cotaLeitura?.restante, 59);
  assert.match(m.chamadas[1].url, /\/contatos\/tipos\?offset=0&limit=100$/);
  assert.equal(m.chamadas[0].token, m.chamadas[1].token);
  await assert.rejects(m.cliente.listarTiposContato!("b", { offset: -1, limit: 100 }), falha("PAGINACAO_INVALIDA"));
  assert.equal(m.chamadas.length, 2);
});

test("tipos de contato são traduzidos para IDs locais antes de POST e PUT", async () => {
  for (const atualizar of [false, true]) {
    const m = mock([{ status: 200, dados: { id: 123 } }]);
    const campos = { nome: "Contato", cpfCnpj: "52998224725", tipoPessoa: "F", tiposContato: [{ nome: "Cliente", perfilContato: 0 }] };
    const opcoes = { validarConta: () => true, catalogoTiposContato: [{ id: "87", nome: "CLIENTE", perfilContato: 0 }] };
    // Sem callback de identidade, mutar mantém o contrato legado do transporte;
    // neste teste fornecemos /info quando a proteção é solicitada.
    const protegido = mock([{ status: 200, dados: { cpfCnpj: "52998224725", razaoSocial: "Conta" } }, { status: 200, dados: { id: 123 } }]);
    if (atualizar) await protegido.cliente.atualizar("b", "CONTATO", "123", campos, opcoes);
    else await protegido.cliente.criar("b", "CONTATO", campos, opcoes);
    assert.deepEqual((protegido.chamadas.at(-1)?.payload as Record<string, unknown>).tipos, [87]);
    assert.equal("tiposContato" in (protegido.chamadas.at(-1)?.payload as Record<string, unknown>), false);
    await assert.rejects(m.cliente.criar("b", "CONTATO", campos), falha("TIPOS_CONTATO_NAO_MAPEADOS"));
    assert.equal(m.chamadas.length, 0);
  }
});

test("catálogo de tipos rejeita resposta truncada ou IDs sem precisão", async () => {
  for (const dados of [pagina([{ id: Number.MAX_SAFE_INTEGER + 1, nome: "Cliente", perfilContato: 0 }]), pagina([], 1001), pagina([{ id: 1, nome: "Cliente" }])]) {
    const m = mock([{ status: 200, dados }]);
    await assert.rejects(m.cliente.listarTiposContato!("b", { offset: 0, limit: 100 }), falha("CONTRATO"));
  }
});

test("catálogo real com perfil textual é normalizado antes da comparação e escrita", async () => {
  const m = mock([{ status: 200, dados: pagina([
    { id: 1, nome: "Outro", perfilContato: "0" }, { id: 87, nome: "Cliente", perfilContato: "1" },
    { id: 88, nome: "Fornecedor", perfilContato: "2" }, { id: 89, nome: "Transportador", perfilContato: "4" },
  ]) }]);
  const catalogo = await m.cliente.listarTiposContato!("b", { offset: 0, limit: 100 });
  assert.deepEqual(catalogo.itens.map(tipo => tipo.perfilContato), [0, 1, 2, 4]);
  assert.equal(catalogo.total, 4);
});

function mock(respostas: (RespostaHttpSync | Error)[], substituir: Partial<DependenciasClienteSync> = {}) {
  const chamadas: RequisicaoSync[] = [];
  const tokens: { aplicativoId: string; rejeitado?: string }[] = [];
  const dependencias: DependenciasClienteSync = {
    async configurar() { return { apiBaseUrl: "https://api.tiny.com.br/public-api/v3" }; },
    async token(aplicativoId, opcoes) { tokens.push({ aplicativoId, rejeitado: opcoes?.tokenRejeitado }); return opcoes?.tokenRejeitado ? "token-renovado" : "token-inicial"; },
    async http(requisicao) {
      chamadas.push(requisicao);
      const resposta = respostas.shift();
      if (!resposta) throw new Error("Sem resposta simulada");
      if (resposta instanceof Error) throw resposta;
      return resposta;
    },
    ...substituir,
  };
  return { cliente: criarClienteSync(dependencias), chamadas, tokens };
}

test("GET tem limite, timeout, credencial do filho e projeção segura", async () => {
  const m = mock([{ status: 200, dados: pagina([{ ...produto, estoque: { saldo: 2 }, precos: { preco: 30 } }]) }]);
  const resposta = await m.cliente.listar("filho-a", "PRODUTO", { offset: 100, limit: 50 });
  assert.equal(resposta.itens[0].completo, false);
  assert.equal(resposta.itens[0].campos.estoque, undefined);
  assert.equal(m.chamadas[0].timeoutMs, 20_000);
  assert.deepEqual(m.tokens, [{ aplicativoId: "filho-a", rejeitado: undefined }]);
  const url = new URL(m.chamadas[0].url);
  assert.equal(url.pathname, "/public-api/v3/produtos");
  assert.equal(url.searchParams.get("limit"), "50");
  assert.equal(url.searchParams.get("offset"), "100");
});

test("GET renova exatamente uma vez depois de 401 e não repete indefinidamente", async () => {
  const m = mock([{ status: 401, dados: { token: "segredo" } }, { status: 401, dados: {} }]);
  await assert.rejects(m.cliente.listar("a", "PRODUTO", { offset: 0, limit: 100 }), falha("OLIST_401", false));
  assert.equal(m.chamadas.length, 2);
  assert.equal(m.tokens.length, 2);
  assert.equal(m.tokens[1].rejeitado, "token-inicial");
  assert.equal(m.chamadas[1].token, "token-renovado");
});

test("GET após renovação retorna resultado e não repete 429 dentro do transporte", async () => {
  const m = mock([{ status: 401, dados: {} }, { status: 200, dados: pagina() }]);
  assert.equal((await m.cliente.listar("a", "PRODUTO", { offset: 0, limit: 100 })).itens.length, 1);
  const limitado = mock([{ status: 429, dados: { secreto: "pessoal" }, retryAfter: "90" }]);
  await assert.rejects(limitado.cliente.listar("a", "PRODUTO", { offset: 0, limit: 100 }), erro => erro instanceof FalhaSync && erro.recuperavel && erro.retryAfterMs === 90_000 && !erro.message.includes("pessoal"));
  assert.equal(limitado.chamadas.length, 1);
});

test("falhas de configuração, OAuth e rede são sanitizadas", async () => {
  const oauth = mock([], { async token() { throw new Error("secret=senha CPF 52998224725"); } });
  await assert.rejects(oauth.cliente.listar("a", "PRODUTO", { offset: 0, limit: 100 }), erro => erro instanceof FalhaSync && erro.codigo === "CONEXAO_OLIST" && !erro.message.includes("52998224725"));
  const rede = mock([new Error("Authorization Bearer meu-token")]);
  await assert.rejects(rede.cliente.listar("a", "PRODUTO", { offset: 0, limit: 100 }), erro => erro instanceof FalhaSync && erro.codigo === "REDE" && erro.recuperavel && !erro.message.includes("meu-token"));
});

test("paginação inválida e URL fora do provedor são rejeitadas antes do HTTP", async () => {
  const m = mock([]);
  for (const opcoes of [{ offset: 0, limit: 101 }, { offset: -1, limit: 20 }, { offset: 1.5, limit: 20 }, { offset: 0, limit: 0 }]) await assert.rejects(m.cliente.listar("a", "PRODUTO", opcoes), falha("PAGINACAO_INVALIDA"));
  assert.equal(m.chamadas.length, 0);
  for (const apiBaseUrl of ["http://api.tiny.com.br/public-api/v3", "https://evil.example.com/public-api/v3", "https://token:secret@api.tiny.com.br/public-api/v3", "https://api.tiny.com.br/privado"]) {
    const externo = mock([], { async configurar() { return { apiBaseUrl }; } });
    await assert.rejects(externo.cliente.listar("a", "PRODUTO", { offset: 0, limit: 100 }), falha("CONFIGURACAO_OLIST"));
    assert.equal(externo.chamadas.length, 0);
  }
});

test("filtros incrementais exigem validação da conta e usam parâmetros específicos", async () => {
  const m = mock([{ status: 200, dados: pagina() }, { status: 200, dados: pagina([]) }]);
  await assert.rejects(m.cliente.listar("a", "PRODUTO", { offset: 0, limit: 100, desde: "2026-11-01" }), falha("INCREMENTAL_NAO_VALIDADO"));
  await m.cliente.listar("a", "PRODUTO", { offset: 0, limit: 100, desde: "2026-11-01", incrementalValidado: true });
  await m.cliente.listar("a", "CONTATO", { offset: 0, limit: 100, desde: "2026-11-01", incrementalValidado: true });
  assert.equal(new URL(m.chamadas[0].url).searchParams.get("dataAlteracao"), "2026-11-01");
  assert.equal(new URL(m.chamadas[1].url).searchParams.get("dataAtualizacao"), "2026-11-01");
  await assert.rejects(m.cliente.listar("a", "VENDEDOR", { offset: 0, limit: 100, desde: "2026-11-01", incrementalValidado: true }), falha("INCREMENTAL_NAO_VALIDADO"));
});

test("HTML, página sem total, excesso de itens e IDs duplicados não simulam ausência", async () => {
  for (const dados of ["<html>erro</html>", {}, { itens: [], paginacao: {} }, pagina([produto, produto]), pagina([produto], -1), pagina([{ ...produto, id: Number.MAX_SAFE_INTEGER + 1 }])]) {
    const m = mock([{ status: 200, dados }]);
    await assert.rejects(m.cliente.listar("a", "PRODUTO", { offset: 0, limit: 100 }), falha("CONTRATO"));
  }
  const m = mock([{ status: 200, dados: pagina([produto, { ...produto, id: 101 }]) }]);
  await assert.rejects(m.cliente.listar("a", "PRODUTO", { offset: 0, limit: 1 }), falha("CONTRATO"));
});

test("busca usa SKU exato, nunca nome, e interrompe resultados truncados", async () => {
  const m = mock([{ status: 200, dados: pagina([produto, { ...produto, id: 101, sku: "001-A" }]) }]);
  const itens = await m.cliente.buscarPorChave("a", "PRODUTO", "001-a");
  assert.deepEqual(itens.map(item => item.id), ["100"]);
  const url = new URL(m.chamadas[0].url);
  assert.equal(url.searchParams.get("codigo"), "001-a");
  assert.equal(url.searchParams.has("nome"), false);
  const truncado = mock([{ status: 200, dados: pagina([produto], 101) }]);
  await assert.rejects(truncado.cliente.buscarPorChave("a", "PRODUTO", "001-a"), falha("BUSCA_TRUNCADA"));
  const cheia = mock([{ status: 200, dados: pagina(Array.from({ length: 100 }, (_, index) => ({ ...produto, id: index + 1 }))) }]);
  await assert.rejects(cheia.cliente.buscarPorChave("a", "PRODUTO", "001-a"), falha("BUSCA_TRUNCADA"));
});

test("busca por documento normaliza sem usar nome como identidade", async () => {
  const m = mock([{ status: 200, dados: pagina([{ id: 11, nome: "Pessoa", tipoPessoa: "F", cpfCnpj: "529.982.247-25", situacao: "B" }]) }]);
  assert.equal((await m.cliente.buscarPorChave("a", "CONTATO", "529.982.247-25"))[0].chave, "52998224725");
  assert.equal(new URL(m.chamadas[0].url).searchParams.get("cpfCnpj"), "52998224725");
});

test("detalhe confirma ID e campos completos; vendedores não têm endpoint inventado", async () => {
  const m = mock([{ status: 200, dados: produto }, { status: 200, dados: { ...produto, id: 200 } }]);
  assert.equal((await m.cliente.detalhar("a", "PRODUTO", "100")).completo, true);
  await assert.rejects(m.cliente.detalhar("a", "PRODUTO", "100"), falha("CONTRATO"));
  await assert.rejects(m.cliente.detalhar("a", "VENDEDOR", "100"), falha("DETALHE_NAO_SUPORTADO"));
  assert.equal(m.chamadas.length, 2);
});

test("formas e vendedores usam observação completa na listagem e são somente leitura", async () => {
  const m = mock([{ status: 200, dados: pagina([{ id: 1, nome: "Pix", situacao: 1 }]) }, { status: 200, dados: pagina([{ id: 2, situacao: "B", contato: { id: 3, nome: "Representante", cpfCnpj: "52998224725", tipoPessoa: "F" } }]) }]);
  assert.equal((await m.cliente.listar("a", "FORMA_PAGAMENTO", { offset: 0, limit: 100 })).itens[0].completo, true);
  assert.equal((await m.cliente.listar("a", "VENDEDOR", { offset: 0, limit: 100 })).itens[0].completo, true);
  for (const entidade of ["FORMA_PAGAMENTO", "VENDEDOR"] as const) {
    await assert.rejects(m.cliente.criar("a", entidade, { nome: "Teste" }), falha("SOMENTE_LEITURA"));
    await assert.rejects(m.cliente.atualizar("a", entidade, "1", { nome: "Teste" }), falha("SOMENTE_LEITURA"));
  }
  assert.equal(m.chamadas.length, 2);
});

test("identidade da conta lê /info e exige documento verificável", async () => {
  const m = mock([{ status: 200, dados: { cpfCnpj: "04.252.011/0001-10", razaoSocial: "Conta filial" } }]);
  assert.deepEqual(await m.cliente.identidadeConta("filho"), { documento: "04252011000110", nome: "Conta filial" });
  assert.equal(new URL(m.chamadas[0].url).pathname, "/public-api/v3/info");
});

test("POST envia somente campos permitidos e retorna ID confirmado", async () => {
  const m = mock([{ status: 200, dados: { id: 901 } }]);
  assert.deepEqual(await m.cliente.criar("a", "PRODUTO", { sku: "001-A", descricao: "Ref Produto", tipo: "S", estoque: { inicial: 99 }, precos: { preco: 500 }, ncm: "111" }), { id: "901" });
  assert.deepEqual(m.chamadas[0].payload, { sku: "001-A", descricao: "Ref Produto", tipo: "S" });
});

test("POST/PUT com 401 nunca renovam nem repetem a escrita", async () => {
  for (const metodo of ["criar", "atualizar"] as const) {
    const m = mock([{ status: 401, dados: {} }]);
    const payload = { sku: "001-A", descricao: "Ref Produto", tipo: "S" };
    await assert.rejects(metodo === "criar" ? m.cliente.criar("a", "PRODUTO", payload) : m.cliente.atualizar("a", "PRODUTO", "1", payload), falha("OLIST_401", false));
    assert.equal(m.chamadas.length, 1);
    assert.equal(m.tokens.length, 1);
  }
});

test("rejeição explícita 429 pode voltar para fila sem repetição no transporte", async () => {
  const m = mock([{ status: 429, dados: {}, retryAfter: "60" }]);
  await assert.rejects(m.cliente.criar("a", "PRODUTO", { sku: "A", descricao: "Ref Produto", tipo: "S" }), erro => erro instanceof FalhaSync && erro.recuperavel && !erro.inconclusivo && erro.retryAfterMs === 60_000);
  assert.equal(m.chamadas.length, 1);
});

test("POST com timeout, 5xx ou sucesso sem ID fica inconclusivo e não pode ser repetido automaticamente", async () => {
  for (const resposta of [new Error("ETIMEDOUT token=secreto"), { status: 500, dados: { segredo: "x" } }, { status: 408, dados: {} }, { status: 200, dados: {} }, { status: 202, dados: { id: 1 } }]) {
    const m = mock([resposta]);
    await assert.rejects(m.cliente.criar("a", "PRODUTO", { sku: "001-A", descricao: "Ref Produto", tipo: "S" }), erro => erro instanceof FalhaSync && erro.inconclusivo && !erro.recuperavel && !erro.message.includes("secreto"));
    assert.equal(m.chamadas.length, 1);
  }
});

test("PUT 204 confirma; falha ambígua exige reconciliação e campos protegidos são omitidos", async () => {
  const m = mock([{ status: 204, dados: undefined }]);
  assert.deepEqual(await m.cliente.atualizar("a", "PRODUTO", "10", { sku: "001-A", descricao: "Ref Novo", tipo: "S", estoque: { saldo: 10 }, precos: { preco: 1 } }), { id: "10" });
  assert.deepEqual(m.chamadas[0].payload, { sku: "001-A", descricao: "Ref Novo" });
  const erro = mock([new Error("Timeout")]);
  await assert.rejects(erro.cliente.atualizar("a", "PRODUTO", "10", { sku: "001-A", descricao: "Ref Novo", tipo: "S" }), falha("MUTACAO_INCONCLUSIVA", true));
});

test("subrecursos requerem contrato e IDs do destino explícitos, sem transferir IDs da origem", async () => {
  const m = mock([{ status: 204, dados: undefined }, { status: 200, dados: { id: 600 } }]);
  const imagens = [{ id: 2, url: "https://cdn.example.com/foto.jpg", externo: true }];
  await assert.rejects(m.cliente.substituirImagens("a", "300", imagens, false), falha("IMAGENS_REQUEREM_VALIDACAO"));
  await m.cliente.substituirImagens("a", "300", imagens, true);
  assert.equal(new URL(m.chamadas[0].url).pathname, "/public-api/v3/produtos/300/anexos");
  assert.deepEqual(m.chamadas[0].payload, [{ url: "https://cdn.example.com/foto.jpg", externo: true }]);
  await m.cliente.criarVariacao("a", "300", { sku: "A-Azul", grade: [{ chave: "Cor", valor: "Azul" }], estoque: { inicial: 100 } }, true);
  assert.equal(new URL(m.chamadas[1].url).pathname, "/public-api/v3/produtos/300/variacoes");
  assert.deepEqual(m.chamadas[1].payload, { sku: "A-Azul", grade: [{ chave: "Cor", valor: "Azul" }] });
});

test("Retry-After aceita segundos/data e limita backoff sem valores negativos", () => {
  assert.equal(retryAfterSync("30"), 30_000);
  assert.equal(retryAfterSync("Mon, 16 Nov 2026 12:00:30 GMT", Date.parse("2026-11-16T12:00:00Z")), 30_000);
  assert.equal(retryAfterSync(-1), 0);
  assert.equal(retryAfterSync("inválido"), 0);
  assert.equal(retryAfterSync(999999999), 86_400_000);
});

test("tokens e aplicativos inválidos não chegam ao transporte HTTP", async () => {
  for (const token of ["", "com espaço", "Bearer\r\ninjetado", "x".repeat(16_385)]) {
    const m = mock([], { async token() { return token; } });
    await assert.rejects(m.cliente.identidadeConta("filho"), falha("CONEXAO_OLIST"));
    assert.equal(m.chamadas.length, 0);
  }
  for (const aplicativo of ["", "x".repeat(151)]) {
    const m = mock([]);
    await assert.rejects(m.cliente.identidadeConta(aplicativo), falha("APLICATIVO_INVALIDO"));
    assert.equal(m.tokens.length, 0);
    assert.equal(m.chamadas.length, 0);
  }
});

test("credenciais são obtidas por filho em cada consulta sem cache cruzado", async () => {
  const configurados: string[] = [];
  const m = mock([{ status: 200, dados: produto }, { status: 200, dados: produto }], {
    async configurar(app) { configurados.push(app); return { apiBaseUrl: "https://api.tiny.com.br/public-api/v3" }; },
    async token(app) { return `credencial-${app}`; },
  });
  await m.cliente.detalhar("filho-a", "PRODUTO", "100");
  await m.cliente.detalhar("filho-b", "PRODUTO", "100");
  assert.deepEqual(configurados, ["filho-a", "filho-b"]);
  assert.deepEqual(m.chamadas.map(chamada => chamada.token), ["credencial-filho-a", "credencial-filho-b"]);
  assert.ok(m.chamadas.every(chamada => !chamada.url.includes("credencial")));
});

test("SKU com caracteres reservados permanece um único parâmetro de busca", async () => {
  const sku = "000-A&offset=999/+/ç?";
  const m = mock([{ status: 200, dados: pagina([{ ...produto, sku }]) }]);
  const resultado = await m.cliente.buscarPorChave("a", "PRODUTO", sku);
  const url = new URL(m.chamadas[0].url);
  assert.equal(url.searchParams.get("codigo"), sku);
  assert.equal(url.searchParams.get("offset"), "0");
  assert.equal(url.searchParams.getAll("offset").length, 1);
  assert.equal(resultado[0].chave, sku);
});

test("erros transitórios de leitura retornam à fila sem retry interno nem corpo sensível", async () => {
  for (const status of [408, 500, 502, 503, 504]) {
    const m = mock([{ status, dados: { cpfCnpj: "52998224725", access_token: "segredo-ficticio" } }]);
    await assert.rejects(m.cliente.detalhar("a", "PRODUTO", "100"), erro =>
      erro instanceof FalhaSync && erro.status === status && erro.recuperavel && !erro.inconclusivo &&
      !erro.message.includes("52998224725") && !erro.message.includes("segredo-ficticio"));
    assert.equal(m.chamadas.length, 1);
  }
});

test("rejeições permanentes de escrita não geram retry ou renovação de token", async () => {
  for (const status of [400, 403, 404, 409, 422]) {
    const m = mock([{ status, dados: { mensagem: "não vazar este corpo" } }]);
    await assert.rejects(m.cliente.atualizar("a", "PRODUTO", "100", produto), erro =>
      erro instanceof FalhaSync && erro.status === status && !erro.recuperavel && !erro.inconclusivo && !erro.message.includes("não vazar"));
    assert.equal(m.chamadas.length, 1);
    assert.equal(m.tokens.length, 1);
  }
});

test("resposta 3xx de escrita é inconclusiva e não gera nova chamada ao transporte", async () => {
  for (const status of [301, 302, 307, 308]) {
    const m = mock([{ status, dados: { location: "https://outro.example.test" } }]);
    await assert.rejects(m.cliente.criar("a", "PRODUTO", produto), falha("MUTACAO_INCONCLUSIVA", true));
    assert.equal(m.chamadas.length, 1);
  }
});

test("resposta aceita de criação com ID inválido exige reconciliação sem reenviar", async () => {
  for (const id of [0, -1, 1.5, "../100", Number.MAX_SAFE_INTEGER + 1]) {
    const m = mock([{ status: 201, dados: { id } }]);
    await assert.rejects(m.cliente.criar("a", "PRODUTO", produto), falha("MUTACAO_INCONCLUSIVA", true));
    assert.equal(m.chamadas.length, 1);
  }
  const m = mock([{ status: 201, dados: { id: "9007199254740993" } }]);
  assert.deepEqual(await m.cliente.criar("a", "PRODUTO", produto), { id: "9007199254740993" });
});

test("busca vazia com total positivo nunca comprova ausência para uma criação", async () => {
  const m = mock([{ status: 200, dados: pagina([], 1) }]);
  await assert.rejects(m.cliente.buscarPorChave("a", "PRODUTO", "001-a"), falha("BUSCA_TRUNCADA"));
  assert.equal(m.chamadas.length, 1);
});

test("conta sem documento ou nome confiável é recusada antes de qualquer escrita", async () => {
  for (const dados of [{ cpfCnpj: "11111111111111", razaoSocial: "Empresa" }, { cpfCnpj: "04252011000110", razaoSocial: " " }, { razaoSocial: "Empresa" }]) {
    const m = mock([{ status: 200, dados }]);
    await assert.rejects(m.cliente.identidadeConta("a"), falha("CONTRATO"));
    assert.ok(m.chamadas.every(chamada => chamada.metodo === "GET"));
  }
});

test("falha na renovação após 401 não executa nova consulta nem revela credenciais", async () => {
  let tokens = 0;
  const m = mock([{ status: 401, dados: {} }], {
    async token(_app, opcoes) {
      tokens++;
      if (opcoes?.tokenRejeitado) throw new Error("refresh_token=segredo-ficticio");
      return "token-inicial";
    },
  });
  await assert.rejects(m.cliente.detalhar("a", "PRODUTO", "100"), erro =>
    erro instanceof FalhaSync && erro.codigo === "CONEXAO_OLIST" && !erro.message.includes("segredo-ficticio"));
  assert.equal(tokens, 2);
  assert.equal(m.chamadas.length, 1);
});

test("POST e PUT usam a mesma credencial validada em info mesmo se houver reconexão", async () => {
  for (const metodo of ["POST", "PUT"] as const) {
    const chamadas: RequisicaoSync[] = [];
    let tokenAtual = "credencial-conta-original", tokens = 0, configuracoes = 0, validacoes = 0;
    const cliente = criarClienteSync({
      configurar: async () => { configuracoes++; return { apiBaseUrl: "https://api.tiny.com.br/public-api/v3" }; },
      token: async () => { tokens++; return tokenAtual; },
      http: async requisicao => {
        chamadas.push(requisicao);
        if (requisicao.metodo === "GET") {
          assert.equal(new URL(requisicao.url).pathname, "/public-api/v3/info");
          tokenAtual = "credencial-outra-conta-apos-reconectar";
          return { status: 200, dados: { cpfCnpj: "529.982.247-25", razaoSocial: "Conta fictícia" } };
        }
        return { status: metodo === "POST" ? 201 : 204, dados: { id: 123 } };
      },
    });
    const opcoes = { validarConta: (identidade: { documento: string; nome: string }) => {
      validacoes++;
      assert.deepEqual(identidade, { documento: "52998224725", nome: "Conta fictícia" });
      return true;
    } };
    const resultado = metodo === "POST"
      ? await cliente.criar("filho-a", "PRODUTO", produto, opcoes)
      : await cliente.atualizar("filho-a", "PRODUTO", "123", produto, opcoes);
    assert.equal(resultado.id, "123");
    assert.equal(configuracoes, 1); assert.equal(tokens, 1); assert.equal(validacoes, 1);
    assert.deepEqual(chamadas.map(r => r.metodo), ["GET", metodo]);
    assert.ok(chamadas.every(r => r.token === "credencial-conta-original"));
    assert.ok(chamadas.every(r => r.timeoutMs === 20_000));
    assert.ok(chamadas.every(r => !r.url.includes("credencial")));
  }
});

test("identidade da conta diferente bloqueia POST e PUT antes de qualquer escrita", async () => {
  for (const metodo of ["POST", "PUT"] as const) {
    const m = mock([{ status: 200, dados: { cpfCnpj: "52998224725", razaoSocial: "Outra conta" } }]);
    const opcoes = { validarConta: () => false };
    const escrever = () => metodo === "POST"
      ? m.cliente.criar("a", "PRODUTO", produto, opcoes)
      : m.cliente.atualizar("a", "PRODUTO", "100", produto, opcoes);
    await assert.rejects(escrever, erro => erro instanceof FalhaSync && erro.codigo === "CONTA_ALTERADA" && !erro.inconclusivo && !erro.recuperavel);
    assert.equal(m.chamadas.length, 1);
    assert.equal(m.chamadas[0].metodo, "GET");
    assert.equal(m.tokens.length, 1);
  }
});

test("info com contrato inválido não valida nem envia a mutação protegida", async () => {
  for (const dados of [{}, { cpfCnpj: "invalido", razaoSocial: "Conta" }, { cpfCnpj: "52998224726", razaoSocial: "Conta" }, { cpfCnpj: "52998224725", razaoSocial: " " }, "<html>erro</html>"]) {
    let validacoes = 0;
    const m = mock([{ status: 200, dados }]);
    await assert.rejects(m.cliente.criar("a", "PRODUTO", produto, { validarConta: () => { validacoes++; return true; } }), falha("CONTRATO", false));
    assert.equal(validacoes, 0);
    assert.deepEqual(m.chamadas.map(r => r.metodo), ["GET"]);
  }
});

test("falha HTTP ou de rede em info não cria resultado de escrita incerto nem renova o token", async () => {
  for (const resposta of [
    { status: 401, dados: { segredo: "nao-expor" } },
    { status: 429, dados: { segredo: "nao-expor" }, retryAfter: "30" },
    { status: 503, dados: { segredo: "nao-expor" } },
    new Error("Authorization Bearer nao-expor"),
  ]) {
    const m = mock([resposta]);
    await assert.rejects(m.cliente.criar("a", "PRODUTO", produto, { validarConta: () => true }), erro =>
      erro instanceof FalhaSync && !erro.inconclusivo && !erro.message.includes("nao-expor"));
    assert.deepEqual(m.chamadas.map(r => r.metodo), ["GET"]);
    assert.equal(m.tokens.length, 1);
  }
});

test("escrita protegida rejeitada ou incerta nunca renova token nem repete POST", async () => {
  for (const resposta of [{ status: 401, dados: {} }, { status: 503, dados: {} }, new Error("Conexão interrompida")]) {
    const m = mock([{ status: 200, dados: { cpfCnpj: "52998224725", fantasia: "Conta" } }, resposta]);
    await assert.rejects(m.cliente.criar("a", "PRODUTO", produto, { validarConta: () => true }), erro =>
      erro instanceof FalhaSync && erro.inconclusivo === (resposta instanceof Error || resposta.status >= 500));
    assert.deepEqual(m.chamadas.map(r => r.metodo), ["GET", "POST"]);
    assert.equal(m.tokens.length, 1);
    assert.ok(m.chamadas.every(r => r.token === "token-inicial"));
  }
});

test("erro no validador de conta falha fechado sem vazar detalhes nem enviar PUT", async () => {
  const m = mock([{ status: 200, dados: { cpfCnpj: "52998224725", razaoSocial: "Conta" } }]);
  await assert.rejects(m.cliente.atualizar("a", "PRODUTO", "100", produto, {
    validarConta: () => { throw new Error("segredo-ficticio=nao-expor"); },
  }), erro => erro instanceof FalhaSync && erro.codigo === "CONTA_ALTERADA" && !erro.inconclusivo && !erro.message.includes("nao-expor"));
  assert.deepEqual(m.chamadas.map(r => r.metodo), ["GET"]);
});

test("payload inválido é recusado antes de consultar info na escrita protegida", async () => {
  const m = mock([]);
  await assert.rejects(m.cliente.criar("a", "PRODUTO", { ...produto, sku: "" }, { validarConta: () => true }), falha("OBRIGATORIOS", false));
  assert.equal(m.chamadas.length, 0);
  assert.equal(m.tokens.length, 0);
});

test("escrita aguarda o guard assíncrono depois de info e antes de enviar POST", { timeout: 2_000 }, async () => {
  let entrou!: () => void, liberar!: () => void;
  const guardIniciado = new Promise<void>(resolve => { entrou = resolve; });
  const guardLiberado = new Promise<void>(resolve => { liberar = resolve; });
  const m = mock([{ status: 200, dados: { cpfCnpj: "52998224725", razaoSocial: "Conta" } }, { status: 201, dados: { id: 123 } }]);
  const escrita = m.cliente.criar("a", "PRODUTO", produto, {
    validarConta: () => true,
    antesDeEscrever: async () => { entrou(); await guardLiberado; },
  });
  try {
    await guardIniciado;
    assert.deepEqual(m.chamadas.map(r => r.metodo), ["GET"]);
  } finally { liberar(); }
  assert.equal((await escrita).id, "123");
  assert.deepEqual(m.chamadas.map(r => r.metodo), ["GET", "POST"]);
  assert.equal(m.tokens.length, 1);
});

test("perda de lease, revogação e revisão obsoleta no guard final impedem PUT e preservam o erro", async () => {
  for (const codigo of ["LEASE_PERDIDA", "AUTORIZACAO_REVOGADA", "ESCOPO_ALTERADO", "PROPOSTA_OBSOLETA"]) {
    const m = mock([{ status: 200, dados: { cpfCnpj: "52998224725", razaoSocial: "Conta" } }]);
    const erro = new FalhaSync(codigo, "A execução foi interrompida antes da escrita.");
    await assert.rejects(m.cliente.atualizar("a", "PRODUTO", "100", produto, {
      validarConta: () => true, antesDeEscrever: async () => { throw erro; },
    }), recebido => recebido === erro);
    assert.deepEqual(m.chamadas.map(r => r.metodo), ["GET"]);
  }
});

test("falha inesperada no guard final é sanitizada e recuperável sem escrita incerta", async () => {
  const m = mock([{ status: 200, dados: { cpfCnpj: "52998224725", razaoSocial: "Conta" } }]);
  await assert.rejects(m.cliente.criar("a", "PRODUTO", produto, {
    validarConta: () => true, antesDeEscrever: async () => { throw new Error("SQL segredo-nao-expor"); },
  }), erro => erro instanceof FalhaSync && erro.codigo === "VALIDACAO_ESCRITA" && erro.recuperavel && !erro.inconclusivo && !erro.message.includes("segredo-nao-expor"));
  assert.deepEqual(m.chamadas.map(r => r.metodo), ["GET"]);
});

test("detalhe e busca protegidos usam o mesmo token de info apesar de uma reconexão", async () => {
  for (const recurso of ["detalhe", "busca"] as const) {
    const chamadas: RequisicaoSync[] = [];
    let tokenAtual = "credencial-original", tokens = 0, configuracoes = 0, consultasAutorizadas = 0;
    const cliente = criarClienteSync({
      configurar: async () => { configuracoes++; return { apiBaseUrl: "https://api.tiny.com.br/public-api/v3" }; },
      token: async () => { tokens++; return tokenAtual; },
      http: async requisicao => {
        chamadas.push(requisicao);
        if (new URL(requisicao.url).pathname.endsWith("/info")) {
          tokenAtual = "credencial-outra-conta";
          return { status: 200, dados: { cpfCnpj: "52998224725", razaoSocial: "Conta" } };
        }
        assert.equal(consultasAutorizadas, 1, "O recurso só pode ser consultado depois do guard");
        return { status: 200, dados: recurso === "detalhe" ? produto : pagina() };
      },
    });
    const opcoes = { validarConta: () => true, antesDeConsultar: async () => { consultasAutorizadas++; } };
    if (recurso === "detalhe") assert.equal((await cliente.detalhar("a", "PRODUTO", "100", opcoes)).id, "100");
    else assert.equal((await cliente.buscarPorChave("a", "PRODUTO", "001-a", opcoes))[0].id, "100");
    assert.equal(chamadas.length, 2);
    assert.equal(tokens, 1); assert.equal(configuracoes, 1);
    assert.ok(chamadas.every(r => r.token === "credencial-original" && r.metodo === "GET"));
  }
});

test("identidade incompatível impede a consulta de detalhe e busca da reconciliação", async () => {
  for (const recurso of ["detalhe", "busca"] as const) {
    const m = mock([{ status: 200, dados: { cpfCnpj: "52998224725", razaoSocial: "Conta diferente" } }]);
    let guard = 0;
    const opcoes = { validarConta: () => false, antesDeConsultar: async () => { guard++; } };
    await assert.rejects(recurso === "detalhe"
      ? m.cliente.detalhar("a", "PRODUTO", "100", opcoes)
      : m.cliente.buscarPorChave("a", "PRODUTO", "001-a", opcoes), falha("CONTA_ALTERADA", false));
    assert.equal(m.chamadas.length, 1); assert.equal(guard, 0);
    assert.equal(new URL(m.chamadas[0].url).pathname, "/public-api/v3/info");
  }
});

test("leitura protegida rejeitada não troca a credencial depois de validar a conta", async () => {
  for (const recurso of ["detalhe", "busca"] as const) {
    const m = mock([{ status: 200, dados: { cpfCnpj: "52998224725", razaoSocial: "Conta" } }, { status: 401, dados: {} }]);
    const opcoes = { validarConta: () => true };
    await assert.rejects(recurso === "detalhe"
      ? m.cliente.detalhar("a", "PRODUTO", "100", opcoes)
      : m.cliente.buscarPorChave("a", "PRODUTO", "001-a", opcoes), falha("OLIST_401", false));
    assert.equal(m.chamadas.length, 2); assert.equal(m.tokens.length, 1);
    assert.ok(m.chamadas.every(r => r.token === "token-inicial"));
  }
});

test("guard da consulta bloqueia o recurso e preserva falha tipada ou sanitiza erro inesperado", async () => {
  for (const erro of [new FalhaSync("LEASE_PERDIDA", "Reserva encerrada."), new Error("SQL segredo-nao-expor")]) {
    const m = mock([{ status: 200, dados: { cpfCnpj: "52998224725", razaoSocial: "Conta" } }]);
    await assert.rejects(m.cliente.detalhar("a", "PRODUTO", "100", {
      validarConta: () => true, antesDeConsultar: async () => { throw erro; },
    }), recebido => erro instanceof FalhaSync ? recebido === erro :
      recebido instanceof FalhaSync && recebido.codigo === "VALIDACAO_CONSULTA" && recebido.recuperavel && !recebido.inconclusivo && !recebido.message.includes("segredo-nao-expor"));
    assert.equal(m.chamadas.length, 1);
  }
});

test("leituras transportam somente números da cota e 429 mantém reset e Retry-After", async () => {
  const cotaLeitura = { limite: 60, restante: 42, resetSegundos: 20 };
  const m = mock([{ status: 200, dados: pagina(), cotaLeitura }, { status: 200, dados: produto, cotaLeitura },
    { status: 200, dados: { cpfCnpj: "04252011000110", razaoSocial: "Conta" }, cotaLeitura }]);
  assert.deepEqual((await m.cliente.listar("a", "PRODUTO", { offset: 0, limit: 100 })).cotaLeitura, cotaLeitura);
  assert.deepEqual((await m.cliente.detalhar("a", "PRODUTO", "100")).cotaLeitura, cotaLeitura);
  assert.deepEqual((await m.cliente.identidadeConta("a")).cotaLeitura, cotaLeitura);
  const limitado = mock([{ status: 429, dados: {}, retryAfter: "90", cotaLeitura: { ...cotaLeitura, restante: 0 } }]);
  await assert.rejects(limitado.cliente.detalhar("a", "PRODUTO", "100"), error => error instanceof FalhaSync && error.status === 429 && error.retryAfterMs === 90_000 && error.cotaLeitura?.restante === 0);
});


test("cache opt-in é por aplicativo/credencial, tem TTL absoluto e não dispensa guard nem escrita fresca", async () => {
  let agora=0, token="token-a", infos=0, guards=0;
  const caminhos:string[]=[];
  const cliente=criarClienteSync({
    agora:()=>agora,
    configurar:async()=>({apiBaseUrl:"https://api.tiny.com.br/public-api/v3"}),
    token:async()=>token,
    http:async r=>{
      caminhos.push(r.url);
      if(r.url.endsWith("/info")){infos++;return {status:200,dados:{cpfCnpj:"52998224725",razaoSocial:"Conta"}};}
      return r.metodo==="GET"?{status:200,dados:produto}:{status:200,dados:{id:100}};
    },
  });
  const opcoes={reutilizarIdentidade:true,validarConta:()=>true,antesDeConsultar:async()=>{guards++;}};
  await cliente.detalhar("a","PRODUTO","100",opcoes);
  agora=59_000;await cliente.detalhar("a","PRODUTO","100",opcoes);
  assert.equal(infos,1);assert.equal(guards,2);
  agora=60_000;await cliente.detalhar("a","PRODUTO","100",opcoes);assert.equal(infos,2);
  token="token-b";await cliente.detalhar("a","PRODUTO","100",opcoes);assert.equal(infos,3);
  await cliente.detalhar("b","PRODUTO","100",opcoes);assert.equal(infos,4);
  await cliente.criar("a","PRODUTO",{sku:"001-a",descricao:"Ref Toalha",tipo:"S"},opcoes);assert.equal(infos,5);
  await cliente.detalhar("a","PRODUTO","100",opcoes);assert.equal(infos,5);
  agora=-1;await cliente.detalhar("a","PRODUTO","100",opcoes);assert.equal(infos,6);
  assert.equal(caminhos.filter(c=>!c.endsWith("/info")).length,8);
});

test("cache não reaproveita autorização e 401 invalida identidade sem retry protegido", async () => {
  let infos=0, rejeitar=false;
  const cliente=criarClienteSync({
    configurar:async()=>({apiBaseUrl:"https://api.tiny.com.br/public-api/v3"}),token:async()=>"token",
    http:async r=>r.url.endsWith("/info")?(infos++,{status:200,dados:{cpfCnpj:"52998224725",razaoSocial:"Conta"}}):{status:rejeitar?401:200,dados:produto},
  });
  const opcoes={reutilizarIdentidade:true,validarConta:()=>true};
  await cliente.detalhar("a","PRODUTO","100",opcoes);
  await assert.rejects(cliente.detalhar("a","PRODUTO","100",{...opcoes,validarConta:()=>false}),falha("CONTA_ALTERADA"));
  await cliente.detalhar("a","PRODUTO","100",opcoes);assert.equal(infos,2);
  rejeitar=true;await assert.rejects(cliente.detalhar("a","PRODUTO","100",opcoes),falha("OLIST_401"));
  rejeitar=false;await cliente.detalhar("a","PRODUTO","100",opcoes);assert.equal(infos,3);
});

test("cadência envolve cada HTTP, publica só metadados e precede guard e marca de envio", async () => {
  const eventos:string[]=[];
  const cliente=criarClienteSync({
    configurar:async()=>({apiBaseUrl:"https://api.tiny.com.br/public-api/v3"}),token:async()=>"token",
    http:async r=>{eventos.push(r.metodo);return r.url.endsWith("/info")?{status:200,dados:{cpfCnpj:"52998224725",razaoSocial:"Conta"},cotaLeitura:{limite:60,restante:12,resetSegundos:20}}:{status:200,dados:{id:100}};},
  });
  const opcoes={validarConta:()=>true,antesDeRequisicao:async(m:string)=>{eventos.push("espera "+m);},
    aposResposta:(m:string,r:object)=>{assert.deepEqual(Object.keys(r).sort(),["cotaLeitura","retryAfterMs","status"]);eventos.push("resposta "+m);},
    antesDeEscrever:async()=>{eventos.push("guard");}};
  await cliente.criar("a","PRODUTO",{sku:"001-a",descricao:"Ref Toalha",tipo:"S"},opcoes);
  assert.deepEqual(eventos,["espera GET","GET","resposta GET","espera POST","guard","POST","resposta POST"]);
  eventos.length=0;
  await assert.rejects(cliente.criar("a","PRODUTO",{sku:"001-a",descricao:"Ref Toalha",tipo:"S"},
    {...opcoes,antesDeRequisicao:async m=>{if(m!=="GET")throw new FalhaSync("COTA_OLIST","Aguarde",true);}}),falha("COTA_OLIST",false));
  assert.ok(!eventos.includes("guard")&&!eventos.includes("POST"));
});

test("PUT contato usa vendedor local explícito e remove campos canônicos nas duas sanitizações", async () => {
  const m = mock([{ status: 200, dados: { cpfCnpj: "04252011000110", razaoSocial: "Conta" } }, { status: 204, dados: null }]);
  await m.cliente.atualizar("destino", "CONTATO", "10", { nome: "Contato", cpfCnpj: "52998224725", tipoPessoa: "F", vendedorNome: "ana", vendedor: { id: 123 } }, { validarConta: () => true, vendedorDestinoId: "987" });
  const put = m.chamadas.find(c => c.metodo === "PUT")!;
  assert.deepEqual((put.payload as Record<string, unknown>).vendedor, { id: 987 });
  assert.equal("vendedorNome" in (put.payload as Record<string, unknown>), false);
  const bloqueada = mock([]);
  await assert.rejects(bloqueada.cliente.atualizar("destino", "CONTATO", "10", { nome: "Contato", cpfCnpj: "52998224725", tipoPessoa: "F", vendedorNome: "ana" }, { validarConta: () => true }), falha("VENDEDOR_CONTATO_NAO_MAPEADO"));
  assert.equal(bloqueada.chamadas.length, 0);
});

test("catálogo de vendedores usa consulta paginada e credencial validada da mesma conta", async () => {
  const m = mock([{ status: 200, dados: { cpfCnpj: "04252011000110", razaoSocial: "Conta" } }, { status: 200, dados: pagina([{ id: 987, contato: { nome: "Ana" }, situacao: "B" }]) }]);
  const resultado = await m.cliente.listarVendedoresContato!("destino", { offset: 0, limit: 100 }, { validarConta: () => true });
  assert.deepEqual(resultado.itens, [{ id: "987", nome: "Ana", situacao: "B" }]);
  assert.equal(new URL(m.chamadas[1].url).pathname, "/public-api/v3/vendedores");
  assert.equal(new URL(m.chamadas[1].url).searchParams.get("limit"), "100");
  const outra = mock([{ status: 200, dados: { cpfCnpj: "04252011000110", razaoSocial: "Conta" } }]);
  await assert.rejects(outra.cliente.listarVendedoresContato!("destino", { offset: 0, limit: 100 }, { validarConta: () => false }), falha("CONTA_ALTERADA"));
  assert.equal(outra.chamadas.length, 1);
});
