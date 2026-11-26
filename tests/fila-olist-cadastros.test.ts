import assert from "node:assert/strict";
import test from "node:test";
import axios, { type AxiosRequestConfig } from "axios";

test("cadastros da fila respeitam estados por recurso e identificam vendedores pelo contato", async t => {
  let clienteEstado = "B", vendedorEstado = "B", produtoEstado = "A", servicoEstado = "A", formaEstado: string | number = 1;
  const consultas: URL[] = [];
  const configuracoes: Array<AxiosRequestConfig | undefined> = [];
  let simularFiltroNome = false;
  let paginaProdutos: Array<Record<string, unknown>> | null = null;
  Object.assign(globalThis, { prisma: {
    aplicativo: { findUnique: async () => ({ olistClientId: "fake", olistClientSecret: "fake" }) },
    integracaoOlistToken: { findUnique: async () => ({ accessToken: "fake", expiresAt: new Date(Date.now() + 3600_000) }) },
  } });
  t.mock.method(axios, "get", async (url: string, config?: AxiosRequestConfig) => {
    configuracoes.push(config);
    const u = new URL(url); consultas.push(u);
    const p = u.pathname;
    let data: unknown;
    if (p.endsWith("/vendedores")) data = { itens: [
      { id: 20, situacao: vendedorEstado, contato: { id: 200, nome: "Ana Vendedora", codigo: "VEN20" } },
      { id: 21, situacao: "A", contato: { nome: "Bia Vendedora", codigo: "VEN21" } },
      { id: 22, situacao: "I", contato: { nome: "Inativo" } },
      { id: 23, situacao: "E", contato: { nome: "Excluído" } },
    ], paginacao: { total: 4 } };
    else if (p.endsWith("/contatos")) data = { itens: [
      { id: 30, situacao: "A", nome: "Cliente A" }, { id: 31, situacao: "B", nome: "Cliente B" },
      { id: 32, situacao: "I", nome: "Cliente I" }, { id: 33, situacao: "E", nome: "Cliente E" },
    ], paginacao: { total: 4 } };
    else if (p.endsWith("/produtos") || p.endsWith("/servicos")) data = { itens: p.endsWith("/produtos") && paginaProdutos ? paginaProdutos : [
      { id: 40, situacao: "A", descricao: p.endsWith("/produtos") ? "Ref Ativo" : "Ativo", precos: { preco: 10 } },
      { id: 41, situacao: "B", descricao: "Bloqueado" }, { id: 42, situacao: "I", descricao: "Inativo" },
    ], paginacao: { total: p.endsWith("/produtos") && paginaProdutos ? paginaProdutos.length : 3 } };
    else {
      const situacao = p.includes("/contatos/") ? clienteEstado : p.includes("/produtos/") ? produtoEstado
        : p.includes("/servicos/") ? servicoEstado : formaEstado;
      data = { id: Number(p.split("/").at(-1)), nome: "Cadastro", situacao };
    }
    if (simularFiltroNome && p.endsWith("/produtos")) {
      const filtro = (u.searchParams.get("nome") ?? "").toLocaleLowerCase("pt-BR");
      const termo = filtro.replace(/^%|%$/g, "");
      const itens = (paginaProdutos ?? []).filter(item => {
        const texto = String(item.nome ?? item.descricao).toLocaleLowerCase("pt-BR");
        return filtro.startsWith("%") && filtro.endsWith("%") ? texto.includes(termo) : texto.startsWith(termo);
      });
      data = { itens, paginacao: { total: itens.length } };
    }
    return { status: 200, data, headers: { "content-type": "application/json" } };
  });
  const { consultarCadastrosFilaOlist, validarSelecoesParciais, nome } = await import("../src/lib/fila-olist-cadastros");
  await t.test("seletor de corte a laser lista GET /servicos da conta destinatária", async () => {
    const antes = consultas.length;
    const r = await consultarCadastrosFilaOlist("destino", new URLSearchParams({ recurso: "servicos", busca: "Corte", pagina: "2" }));
    const chamadas = consultas.slice(antes);
    assert.equal(chamadas.length, 1); assert.ok(chamadas[0].pathname.endsWith("/servicos"));
    assert.equal(chamadas[0].searchParams.get("nome"), "Corte");
    assert.equal(chamadas[0].searchParams.get("limit"), "50"); assert.equal(chamadas[0].searchParams.get("offset"), "50");
    assert.deepEqual(r.itens.map(i => i.id), [40]);
  });
  await t.test("cliente A e B aparecem na mesma página limitada e filtrada por vendedor", async () => {
    const r = await consultarCadastrosFilaOlist("conta", new URLSearchParams({ recurso: "clientes", pagina: "2", busca: "Ana" }), { vendedorId: 20 });
    assert.deepEqual(r.itens.map(i => i.id), [30, 31]);
    const query = consultas.at(-1)!.searchParams;
    assert.equal(query.has("situacao"), false);
    assert.equal(query.get("limit"), "50"); assert.equal(query.get("offset"), "50");
    assert.equal(query.get("nome"), "Ana"); assert.equal(query.get("idVendedor"), "20");
  });
  await t.test("vendedores ativos usam contato.nome e contato.codigo, preservando seu próprio ID", async () => {
    const r = await consultarCadastrosFilaOlist("conta", new URLSearchParams({ recurso: "vendedores" }));
    assert.deepEqual(r.itens.map(i => [i.id, i.nome, "referencia" in i ? i.referencia : undefined]), [[20, "Ana Vendedora", "VEN20"], [21, "Bia Vendedora", "VEN21"]]);
    assert.equal(nome({ id: 20, contato: { nome: "Ana" } }), "Ana");
    assert.equal(nome({ id: 40, descricao: "Oxford" }), "Oxford");
    assert.equal(nome({ id: 50, contato: "inválido" }), "50");
  });
  await t.test("A e B são válidos para cliente/vendedor na confirmação; I e E permanecem bloqueados", async () => {
    for (clienteEstado of ["A", "B"]) for (vendedorEstado of ["A", "B"]) {
      const r = await validarSelecoesParciais("conta", { recursoForma: "RECEBIMENTO" as const, clienteId: 30, vendedorId: 20 });
      assert.equal(r.cliente?.situacao, clienteEstado); assert.equal(r.vendedor?.situacao, vendedorEstado);
      assert.equal(nome(r.vendedor!), "Ana Vendedora");
    }
    clienteEstado = "I"; await assert.rejects(validarSelecoesParciais("conta", { recursoForma: "RECEBIMENTO" as const, clienteId: 30, vendedorId: 20 }), /inativos/);
    clienteEstado = "E"; await assert.rejects(validarSelecoesParciais("conta", { recursoForma: "RECEBIMENTO" as const, clienteId: 30, vendedorId: 20 }), /inativos/);
    clienteEstado = "B";
    for (vendedorEstado of ["I", "E"]) await assert.rejects(validarSelecoesParciais("conta", { recursoForma: "RECEBIMENTO" as const, clienteId: 30, vendedorId: 20 }), /Vendedor indisponível/);
    vendedorEstado = "B";
  });
  await t.test("aceitar B para pessoas não libera produtos, serviços ou pagamentos bloqueados", async () => {
    for (const recurso of ["produtos", "servicos"]) {
      const r = await consultarCadastrosFilaOlist("conta", new URLSearchParams({ recurso }));
      assert.deepEqual(r.itens.map(i => i.id), [40]);
    }
    produtoEstado = "B";
    await assert.rejects(validarSelecoesParciais("conta", { tecidos: [{ tecidoId: "tecido", id: 40, preco: 10 }] }), /inativo/);
    produtoEstado = "A"; servicoEstado = "B";
    await assert.rejects(validarSelecoesParciais("conta", { laser: { id: 50, preco: 1 } }), /inativo/);
    servicoEstado = "A"; formaEstado = "B";
    await assert.rejects(validarSelecoesParciais("conta", { recursoForma: "RECEBIMENTO" as const, formaId: 60 }), /inativos/);
  });
  await t.test("catálogo pesquisa Ref no meio do nome sem varrer produtos sem referência", async () => {
    simularFiltroNome = true;
    paginaProdutos = [
      { id: 501, situacao: "A", descricao: "BASE I BEMBER 100% POLIESTER Ref. 7391", precos: { preco: 10 } },
      { id: 502, situacao: "A", descricao: "FOURWAY SUBLIME 3 95%POLI5%ELASTRef. 5168", precos: { preco: 18.99 } },
      { id: 503, situacao: "A", descricao: "Tecido sem referência" },
    ];
    try {
      for (const busca of ["ref", "Ref", " REF ", ""]) {
        const antes = consultas.length;
        const r = await consultarCadastrosFilaOlist("conta", new URLSearchParams({ recurso: "produtos", busca }));
        assert.deepEqual(r.itens.map(i => i.id), [501, 502]);
        assert.equal(consultas.length - antes, 1);
        assert.equal(consultas.at(-1)!.searchParams.get("nome"), "%Ref%");
        assert.equal(consultas.at(-1)!.searchParams.get("limit"), "50");
        assert.equal(consultas.at(-1)!.searchParams.get("situacao"), "A");
      }
    } finally { simularFiltroNome = false; paginaProdutos = null; }
  });
  await t.test("produtos com Ref preservam termo, preço e uma única página remota", async () => {
    paginaProdutos = [
      { id: 40, situacao: "A", descricao: "Oxford REF", precos: { preco: 10 } },
      { id: 41, situacao: "A", nome: "ref - Oxford Premium", precos: { preco: 12 } },
      { id: 42, situacao: "A", descricao: "Oxford" },
      { id: 43, situacao: "A", descricao: "Oxford preferido" },
      { id: 44, situacao: "A", descricao: "Oxford REF123" },
      { id: 45, situacao: "B", descricao: "REF Oxford bloqueado" },
    ];
    const antes = consultas.length;
    const r = await consultarCadastrosFilaOlist("conta", new URLSearchParams({ recurso: "produtos", busca: "  Oxford  ", pagina: "2" }));
    assert.deepEqual(r.itens.map(i => [i.id, i.nome, "preco" in i ? i.preco : null]), [[40, "Oxford REF", 10], [41, "ref - Oxford Premium", 12]]);
    assert.equal(consultas.length - antes, 1);
    const query = consultas.at(-1)!.searchParams;
    assert.equal(query.get("nome"), "Oxford"); assert.equal(query.get("offset"), "50"); assert.equal(query.get("limit"), "50");
    assert.equal(r.mais, false);
    await consultarCadastrosFilaOlist("conta", new URLSearchParams({ recurso: "produtos", busca: "   " }));
    assert.equal(consultas.at(-1)!.searchParams.get("nome"), "%Ref%");
    const servicos = await consultarCadastrosFilaOlist("conta", new URLSearchParams({ recurso: "servicos" }));
    assert.equal(consultas.at(-1)!.searchParams.has("nome"), false);
    assert.deepEqual(servicos.itens.map(i => i.id), [40]);
  });
  await t.test("busca FOURWAY mantém as duas referências elegíveis e exclui o tecido sem Ref", async () => {
    paginaProdutos = [
      { id: 6887, situacao: "A", descricao: "BASEITWILL FOURWAY 92%POLIESTER8% Ref. 6887", precos: { preco: 15.99 } },
      { id: 5168, situacao: "A", descricao: "FOURWAY SUBLIME 3 95%POLI5%ELASTRef. 5168 1J3B4C6D2B", precos: { preco: 18.99 } },
      { id: 1000, situacao: "A", descricao: "Tecido Fourway Begonia Spandex Sedinha Elastano Poliéster", precos: { preco: 10.99 } },
    ];
    const antes = consultas.length;
    const resultado = await consultarCadastrosFilaOlist("conta", new URLSearchParams({ recurso: "produtos", busca: "FOURWAY" }));
    assert.deepEqual(resultado.itens.map(i => i.id), [6887, 5168]);
    assert.equal(consultas.at(-1)!.searchParams.get("nome"), "FOURWAY");
    assert.equal(consultas.length - antes, 1);
  });
  await t.test("produtos propagam cancelamento e prazo ao provedor sem alterar o contrato da listagem", async () => {
    const controller = new AbortController();
    await consultarCadastrosFilaOlist("conta", new URLSearchParams({ recurso: "produtos", busca: "ref" }), undefined, controller.signal);
    assert.equal(configuracoes.at(-1)?.timeout, 20_000);
    assert.equal(configuracoes.at(-1)?.signal, controller.signal);
    const chamadas = consultas.length;
    controller.abort();
    await assert.rejects(consultarCadastrosFilaOlist("conta", new URLSearchParams({ recurso: "produtos" }), undefined, controller.signal), { name: "AbortError" });
    assert.equal(consultas.length, chamadas, "Consulta cancelada não chega à Olist");
  });
  await t.test("página sem produtos elegíveis conserva próxima página conforme os resultados brutos", async () => {
    paginaProdutos = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, situacao: "A", descricao: `Oxford ${i}` }));
    const antes = consultas.length;
    const primeira = await consultarCadastrosFilaOlist("conta", new URLSearchParams({ recurso: "produtos", busca: "Oxford" }));
    assert.deepEqual(primeira.itens, []); assert.equal(primeira.mais, true); assert.equal(primeira.pagina, 1);
    assert.equal(consultas.length - antes, 1, "Não percorre páginas adicionais dentro da requisição");
    paginaProdutos = [{ id: 51, situacao: "A", descricao: "Oxford (Ref)" }];
    const proxima = await consultarCadastrosFilaOlist("conta", new URLSearchParams({ recurso: "produtos", busca: "Oxford", pagina: "2" }));
    assert.deepEqual(proxima.itens.map(i => i.id), [51]); assert.equal(proxima.mais, false);
    assert.equal(consultas.at(-1)!.searchParams.get("offset"), "50");
  });
});
