import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import type { DependenciasCorrespondenciaPedidoManual } from "../src/lib/pedido-manual-correspondencia";
import type { ReferenciaPedidoManual } from "../src/lib/pedido-manual-referencia";

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const pai = uuid(1), origem = uuid(2), destino = uuid(3);
const usuario = { id: uuid(10), aplicativoId: pai, podeSelecionarFilialFornecedor: true };
const docVendedor = "52998224725", docCliente = "04252011000110";
type Cadastro = Record<string, unknown>;
function dados() {
  const contatos = new Map<string, Cadastro[]>([
    [origem, [
      { id: 111, nome: "Ana Vendedora", codigo: "ORIGEM-11", cpfCnpj: docVendedor, situacao: "B" },
      { id: 21, nome: "Cliente Original", cpfCnpj: docCliente, situacao: "A", endereco: { uf: " mg " }, vendedor: { id: 11 } },
    ]],
    [destino, [
      { id: 331, nome: "Ana no destino", codigo: "DESTINO-31", cpfCnpj: docVendedor, situacao: "A" },
      { id: 41, nome: "Cliente renomeado", cpfCnpj: docCliente, situacao: "B", endereco: { uf: "SP" }, vendedor: { id: 31 } },
    ]],
  ]);
  const vendedores = new Map<string, Cadastro[]>([
    [origem, [{ id: 11, situacao: "B", contato: { ...contatos.get(origem)![0] } }]],
    [destino, [{ id: 31, situacao: "A", contato: { ...contatos.get(destino)![0] } }]],
  ]);
  const aplicativos = [{ id: origem, nome: "A Origem" }, { id: destino, nome: "B Destino" }, { id: pai, nome: "Z Pai" }];
  const vinculos = new Map<string, number>([[origem, 11], [destino, 31]]);
  const consultas: Array<{ app: string; caminho: string; parametros: Record<string, string>; timeout: number }> = [];
  let agora = 0, custoConsulta = 0, falha = false, paginaIncompleta = false;
  const deps: DependenciasCorrespondenciaPedidoManual = {
    listarAplicativos: async () => aplicativos,
    autorizarConta: async (_autor, app) => {
      if (!aplicativos.some(a => a.id === app)) {
        const { ErroFilaOlist } = await import("../src/lib/fila-olist-cadastros"); throw new ErroFilaOlist("não autorizado", 403);
      }
      if (vinculos.size && !vinculos.has(app)) {
        const { ErroAutorizacaoOlist } = await import("../src/lib/olist-autorizacao"); throw new ErroAutorizacaoOlist("sem vínculo nesta empresa", 403);
      }
      return { vendedorId: vinculos.get(app) ?? null };
    },
    agora: () => agora,
    consultar: async (app, caminho, parametros, timeout) => {
      consultas.push({ app, caminho, parametros, timeout }); agora += custoConsulta;
      if (falha) throw new Error("Authorization Bearer segredo; cpfCnpj=" + docCliente);
      if (caminho.startsWith("contatos/")) return contatos.get(app)?.find(c => String(c.id) === caminho.split("/")[1]) ?? { error: "ausente" };
      let itens = caminho === "contatos" ? contatos.get(app) ?? [] : vendedores.get(app) ?? [];
      if (parametros.cpfCnpj) itens = itens.filter(c => c.cpfCnpj === parametros.cpfCnpj);
      if (parametros.codigo) itens = itens.filter(c => (c.contato as Cadastro)?.codigo === parametros.codigo);
      if (parametros.nome) itens = itens.filter(c => String((c.contato as Cadastro)?.nome ?? c.nome).toLocaleLowerCase("pt-BR").includes(parametros.nome.toLocaleLowerCase("pt-BR")));
      const total = itens.length;
      const offset = Number(parametros.offset ?? "0"), limit = Number(parametros.limit ?? "100");
      itens = itens.slice(offset, offset + limit);
      return { itens, paginacao: { total: paginaIncompleta ? total + 1 : total } };
    },
  };
  return { deps, contatos, vendedores, aplicativos, vinculos, consultas,
    cliente: (app = origem) => contatos.get(app)![1], vendedor: (app = origem) => vendedores.get(app)![0],
    set falha(v: boolean) { falha = v; }, set incompleta(v: boolean) { paginaIncompleta = v; }, set custo(v: number) { custoConsulta = v; } };
}

test("correspondência manual: origem canônica, identidade e isolamento entre aplicativos", async t => {
  // As dependências de rede e banco são substituídas; nenhum serviço real é acessado.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
  const bancoSimulado = {};
  Object.assign(globalThis, { prisma: bancoSimulado });
  const { criarServicoCorrespondenciaPedidoManual } = await import("../src/lib/pedido-manual-correspondencia");
  const criar = (d = dados()) => ({ d, servico: criarServicoCorrespondenciaPedidoManual(d.deps) });
  const entrada = { vendedorOrigemId: 11, clienteOrigemId: 21 };
  const referencia = async (s: ReturnType<typeof criar>["servico"]) => s.obterReferenciaPedidoManual(usuario, entrada);

  await t.test("primeiro filho é referência, documentos são canônicos e UF é somente do endereço principal", async () => {
    const { d, servico } = criar(); d.cliente().cpfCnpj = "04.252.011/0001-10";
    d.cliente().enderecoCobranca = { uf: "RJ" };
    const ref = await referencia(servico);
    assert.equal(ref.aplicativoId, origem); assert.equal(ref.cliente.cpfCnpj, docCliente); assert.equal(ref.cliente.uf, "MG");
    assert.equal(ref.vendedor.id, 11); assert.equal(d.consultas.length, 2);
    await assert.rejects(servico.obterReferenciaPedidoManual(usuario, { ...entrada, aplicativoOrigemId: destino }), /primeiro aplicativo/);
    await assert.rejects(servico.obterReferenciaPedidoManual(usuario, { ...entrada, aplicativoOrigemId: pai }), /primeiro aplicativo/);
  });
  await t.test("origem própria é usada somente quando não há filhos", async () => {
    const { d, servico } = criar();
    d.aplicativos.splice(0, d.aplicativos.length, { id: pai, nome: "Única" });
    d.contatos.set(pai, d.contatos.get(origem)!); d.vendedores.set(pai, d.vendedores.get(origem)!);
    d.vinculos.clear();
    assert.equal((await referencia(servico)).aplicativoId, pai);
  });
  await t.test("autorização e vínculo da referência não são substituídos por outra conta", async () => {
    const { d, servico } = criar();
    await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, await referencia(servico), uuid(99)), /não autorizado/);
    d.consultas.length = 0;
    d.vinculos.delete(origem);
    await assert.rejects(referencia(servico), /sem vínculo/);
    assert.equal(d.consultas.length, 0);
  });
  await t.test("vendedor fixo e carteira da origem são conferidos no servidor", async () => {
    const { d, servico } = criar();
    await assert.rejects(servico.obterReferenciaPedidoManual(usuario, { ...entrada, vendedorOrigemId: 999 }), /vendedor vinculado/);
    d.cliente().vendedor = { id: 999 };
    await assert.rejects(referencia(servico), /vendedor vinculado/);
  });
  await t.test("mesmo documento aceita nomes diferentes e resolve IDs/código exclusivamente do destino", async () => {
    const { d, servico } = criar(); const ref = await referencia(servico);
    const r = await servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino);
    assert.equal(r.clienteId, 41); assert.equal(r.vendedorId, 31); assert.equal(r.vendedorFixo, true);
    const filtrosDestino = d.consultas.filter(c => c.app === destino && c.caminho === "vendedores");
    assert.deepEqual(filtrosDestino.map(c => c.parametros.codigo), [undefined]);
    assert.equal(filtrosDestino.some(c => c.parametros.codigo === "ORIGEM-11"), false);
    assert.equal(r.cadastros.cliente.id, 41); assert.equal(r.cadastros.vendedor.id, 31);
    assert.ok(d.consultas.every(c => c.timeout > 0 && c.timeout <= 5000));
  });
  await t.test("revalidação da origem usa ID mesmo com código de contato diferente ou ausente", async () => {
    for (const codigo of ["CODIGO-DIFERENTE", undefined]) {
      const { d, servico } = criar(); const ref = await referencia(servico);
      d.contatos.get(origem)![0].codigo = codigo;
      const antes = d.consultas.length;
      const r = await servico.resolverCorrespondenciaPedidoManual(usuario, ref, origem);
      assert.equal(r.vendedorId, 11);
      assert.equal(r.vendedorFixo, true);
      assert.deepEqual(d.consultas.slice(antes).map(c => c.caminho), ["contatos/21", "vendedores"]);
      assert.equal(d.consultas.at(-1)!.parametros.codigo, undefined);
      (d.vendedor().contato as Cadastro).cpfCnpj = docCliente;
      await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, origem), /vendedor de referência/);
    }
  });
  await t.test("vendedor vinculado no destino independe do código ou da busca de contatos", async () => {
    const { d, servico } = criar(); const ref = await referencia(servico);
    d.contatos.get(destino)!.splice(0, 1);
    const antes = d.consultas.length;
    const r = await servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino);
    assert.equal(r.vendedorId, 31);
    assert.equal(r.vendedorFixo, true);
    assert.equal(d.consultas.slice(antes).some(c => c.app === destino && c.parametros.cpfCnpj === docVendedor), false);
    (d.vendedor(destino).contato as Cadastro).cpfCnpj = docCliente;
    await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino), /outra pessoa/);
  });
  await t.test("sem vínculo em nenhuma conta permite seleção livre, preservando permissões", async () => {
    const { d, servico } = criar(); d.vinculos.clear();
    d.cliente().vendedor = { id: 999 }; d.cliente(destino).vendedor = { id: 999 };
    const ref = await referencia(servico);
    const r = await servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino);
    assert.equal(r.vendedorFixo, false); assert.equal(r.vendedorId, 31);
  });
  await t.test("destino sem vínculo, vínculo conflitante ou cliente fora da carteira bloqueiam", async () => {
    const { d, servico } = criar(); const ref = await referencia(servico);
    d.vinculos.delete(destino); await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino), /sem vínculo/);
    d.vendedores.get(destino)!.push({ id: 999, contato: { nome: "Outra pessoa", cpfCnpj: docCliente } });
    d.vinculos.set(destino, 999); await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino), /outra pessoa/);
    d.vinculos.set(destino, 31); d.cliente(destino).vendedor = { id: 999 };
    await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino), /vendedor vinculado/);
    await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, uuid(999)), /não autorizado/);
  });
  await t.test("histórico preserva fallback por nome conservador só para cadastros realmente sem documento", async () => {
    const { d, servico } = criar();
    (d.vendedor().contato as Cadastro).cpfCnpj = null;
    (d.vendedor(destino).contato as Cadastro).cpfCnpj = null;
    (d.vendedor(destino).contato as Cadastro).nome = "Ana Vendedora";
    const base = await referencia(servico);
    const ref: ReferenciaPedidoManual = { ...base, cliente: { ...base.cliente, nome: "Éva Santos", cpfCnpj: null } };
    d.cliente().cpfCnpj = null; d.cliente().nome = " Éva   Santos ";
    d.cliente(destino).cpfCnpj = null; d.cliente(destino).nome = "ÉVA SANTOS";
    assert.equal((await servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino)).clienteId, 41);
    d.cliente(destino).nome = "Eva Santos";
    await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino), /Cliente não encontrado/);
    d.cliente(destino).nome = "ÉVA SANTOS"; d.cliente(destino).cpfCnpj = docCliente;
    await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino), /Cliente com o mesmo nome e documento preenchido/);
  });
  await t.test("criação exige CPF/CNPJ cadastrado no cliente para valores nulos ou vazios", async () => {
    for (const cpfCnpj of [null, "", "   "]) {
      const { d, servico } = criar(); d.cliente().cpfCnpj = cpfCnpj;
      await assert.rejects(referencia(servico), (error: unknown) => error instanceof Error && "status" in error && error.status === 409 &&
        error.message === "Cadastre o CPF/CNPJ do cliente no aplicativo de referência antes de criar o pedido.");
      assert.equal(d.consultas.length, 1, "o aviso usa o detalhe existente e evita procurar o vendedor desnecessariamente");
    }
  });
  await t.test("criação também rejeita referência sem documento e documento removido na releitura", async () => {
    const { d, servico } = criar(); const ref = await referencia(servico);
    const historica: ReferenciaPedidoManual = { ...ref, cliente: { ...ref.cliente, cpfCnpj: null } };
    const antes = d.consultas.length;
    await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, historica, destino, { validarDadosDirecionamento: true }), /Cadastre o CPF\/CNPJ/);
    assert.equal(d.consultas.length, antes, "referência canônica sem documento não dispara consultas na criação");
    for (const cpfCnpj of [null, "", " "]) {
      d.cliente().cpfCnpj = cpfCnpj;
      await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino, { validarDadosDirecionamento: true }), /Cadastre o CPF\/CNPJ/);
    }
    assert.equal(d.consultas.filter(c => c.app === destino).length, 0);
  });
  await t.test("cliente documentado não usa nome para aceitar destino sem documento ou divergente", async () => {
    const { d, servico } = criar(); const ref = await referencia(servico);
    d.cliente(destino).nome = ref.cliente.nome;
    for (const cpfCnpj of [null, "", "OUTRO"]) {
      d.cliente(destino).cpfCnpj = cpfCnpj;
      await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino, { validarDadosDirecionamento: true }), /Cliente não encontrado/);
    }
  });
  await t.test("histórico sem documento bloqueia homônimos documentados sem escolher outro cliente", async () => {
    const { d, servico } = criar(); const base = await referencia(servico);
    const ref: ReferenciaPedidoManual = { ...base, cliente: { ...base.cliente, cpfCnpj: null } };
    d.cliente().cpfCnpj = null; d.cliente(destino).cpfCnpj = null; d.cliente(destino).nome = ref.cliente.nome;
    d.contatos.get(destino)!.push({ ...d.cliente(destino), id: 42, cpfCnpj: docCliente });
    await assert.rejects(servico.validarReferenciaPersistidaPedidoManual(usuario, ref, destino, { clienteId: 41, vendedorId: 31 }), /Cliente com o mesmo nome e documento preenchido/);
    d.contatos.get(destino)!.pop();
    assert.equal((await servico.validarReferenciaPersistidaPedidoManual(usuario, ref, destino, { clienteId: 41, vendedorId: 31 })).clienteId, 41);
    d.contatos.get(destino)!.push({ ...d.cliente(destino), id: 42 });
    await assert.rejects(servico.validarReferenciaPersistidaPedidoManual(usuario, ref, destino, { clienteId: 41, vendedorId: 31 }), /mais de um cliente/);
    d.contatos.get(destino)!.pop();
    d.cliente(destino).cpfCnpj = docCliente;
    await assert.rejects(servico.validarReferenciaPersistidaPedidoManual(usuario, ref, destino, { clienteId: 41, vendedorId: 31 }), /Cliente com o mesmo nome e documento preenchido/);
  });
  await t.test("novo pedido aceita vendedor sem documento com nome único, mas não o substitui por homônimo documentado", async () => {
    const { d, servico } = criar();
    (d.vendedor().contato as Cadastro).cpfCnpj = null;
    (d.vendedor(destino).contato as Cadastro).cpfCnpj = null;
    (d.vendedor(destino).contato as Cadastro).nome = "Ana Vendedora";
    const ref = await referencia(servico);
    assert.equal((await servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino, { validarDadosDirecionamento: true })).vendedorId, 31);
    (d.vendedor(destino).contato as Cadastro).cpfCnpj = docVendedor;
    await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino, { validarDadosDirecionamento: true }), /Vendedor com o mesmo nome e documento preenchido/);
  });
  await t.test("vendedores sem documento bloqueiam homônimos na origem e no destino", async () => {
    for (const app of [origem, destino]) for (const cpfCnpj of [null, docVendedor]) {
      const { d, servico } = criar();
      (d.vendedor().contato as Cadastro).cpfCnpj = null;
      (d.vendedor(destino).contato as Cadastro).cpfCnpj = null;
      (d.vendedor(destino).contato as Cadastro).nome = "Ana Vendedora";
      const ref = await referencia(servico);
      d.vendedores.get(app)!.push({ ...d.vendedor(app), id: app === origem ? 12 : 32,
        contato: { ...(d.vendedor(app).contato as Cadastro), cpfCnpj } });
      await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino, { validarDadosDirecionamento: true }),
        cpfCnpj === null ? /mais de um vendedor/ : /Vendedor com o mesmo nome e documento preenchido/);
      if (app === origem) assert.equal(d.consultas.filter(c => c.app === destino).length, 0);
    }
  });
  await t.test("documento divergente não cai para nome e documento preenchido inválido não se torna ausente", async () => {
    const { d, servico } = criar(); const ref = await referencia(servico);
    d.cliente(destino).nome = ref.cliente.nome; d.cliente(destino).cpfCnpj = "OUTRO";
    await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino), /Cliente não encontrado/);
    d.cliente().cpfCnpj = "---";
    await assert.rejects(referencia(servico), /não pôde ser identificado/);
    d.cliente().cpfCnpj = "00000000000";
    assert.equal((await referencia(servico)).cliente.cpfCnpj, "00000000000", "identidade de contato não executa validação fiscal");
  });
  await t.test("resumo sem documento é detalhado; detalhe sem documento explícito não autoriza fallback", async () => {
    const { d, servico } = criar(); delete (d.vendedor().contato as Cadastro).cpfCnpj;
    assert.equal((await referencia(servico)).vendedor.cpfCnpj, docVendedor);
    assert.ok(d.consultas.some(c => c.caminho === "contatos/111"));
    delete d.cliente().cpfCnpj;
    await assert.rejects(referencia(servico), /confirmar o documento/);
  });
  await t.test("cliente ou vendedor duplicado no destino não recebe seleção arbitrária", async () => {
    const { d, servico } = criar(); d.vinculos.clear(); const ref = await referencia(servico);
    d.contatos.get(destino)!.push({ ...d.cliente(destino), id: 42 });
    await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino), /mais de um cliente/);
    d.contatos.get(destino)!.pop(); d.vendedores.get(destino)!.push({ ...d.vendedor(destino), id: 32 });
    await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino), /mais de um vendedor/);
  });
  await t.test("A e B são ativos; inativos, resposta incompleta e falha de API bloqueiam sem expor PII", async () => {
    const { d, servico } = criar(); const ref = await referencia(servico);
    for (const situacao of ["I", "E"]) { d.vendedor(destino).situacao = situacao;
      await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino), /Vendedor indisponível/); }
    d.vendedor(destino).situacao = "B"; d.cliente(destino).situacao = "I";
    await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino), /Cliente indisponível/);
    d.cliente(destino).situacao = "A"; d.incompleta = true;
    await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino), /correspondência única/);
    d.incompleta = false; d.falha = true;
    await assert.rejects(referencia(servico), (error: unknown) => error instanceof Error && !error.message.includes(docCliente) && !error.message.includes("segredo"));
  });
  await t.test("UF desconhecida/ausente não usa cobrança nem destino como substituição", async () => {
    const { d, servico } = criar(); d.cliente().endereco = { uf: "XX" }; d.cliente().enderecoCobranca = { uf: "MG" };
    assert.equal((await referencia(servico)).cliente.uf, null);
    delete d.cliente().endereco; assert.equal((await referencia(servico)).cliente.uf, null);
  });
  await t.test("lookup de vendedor por ID é limitado a quatro páginas e o prazo encerra a resolução", async () => {
    const { d, servico } = criar(); d.vinculos.clear();
    d.vendedores.set(origem, Array.from({ length: 600 }, (_, i) => ({ id: i + 100, situacao: "A", contato: { nome: "Pessoa", cpfCnpj: null } })));
    await assert.rejects(servico.obterReferenciaPedidoManual(usuario, { ...entrada, vendedorOrigemId: 9999 }), /excedeu o limite/);
    assert.equal(d.consultas.filter(c => c.caminho === "vendedores").length, 4);
    const outro = criar(); outro.d.custo = 7000;
    await assert.rejects(referencia(outro.servico), /excedeu o prazo/);
  });
  await t.test("ref persistida preserva origem histórica autorizada, mas revalida identidade e IDs finais", async () => {
    const { d, servico } = criar(); const ref = await referencia(servico);
    d.aplicativos.unshift({ id: uuid(99), nome: "0 Nova conta" });
    const r = await servico.validarReferenciaPersistidaPedidoManual(usuario, ref, destino, { clienteId: 41, vendedorId: 31 });
    assert.equal(r.clienteId, 41);
    await assert.rejects(servico.validarReferenciaPersistidaPedidoManual(usuario, ref, destino, { clienteId: 21, vendedorId: 11 }), /não correspondem/);
    d.cliente().cpfCnpj = "ALTERADO";
    await assert.rejects(servico.validarReferenciaPersistidaPedidoManual(usuario, ref, destino, { clienteId: 41, vendedorId: 31 }), /cliente de referência foi alterado/);
  });
  await t.test("criação bloqueia UF alterada na releitura, inclusive quando o destino é a própria origem", async () => {
    const { d, servico } = criar(); const ref = await referencia(servico);
    d.cliente().endereco = { uf: "SP" };
    for (const app of [destino, origem]) {
      await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, app, { validarDadosDirecionamento: true }),
        (error: unknown) => error instanceof Error && "status" in error && error.status === 409 && /Revise o direcionamento/.test(error.message));
    }
    assert.equal(d.consultas.filter(c => c.app === destino).length, 0, "a mudança da origem é detectada antes das consultas ao destino");
  });
  await t.test("criação bloqueia nome alterado mantendo documento e UF", async () => {
    const { d, servico } = criar(); const ref = await referencia(servico);
    d.cliente().nome = "Marketplace Cliente";
    await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino, { validarDadosDirecionamento: true }), /Dados do cliente alterados/);
    assert.equal(d.consultas.filter(c => c.app === destino).length, 0);
  });
  await t.test("normalizações que não alteram as regras são aceitas sem consultas adicionais", async () => {
    const { d, servico } = criar(); const ref = await referencia(servico);
    d.cliente().nome = "  ＣＬＩＥＮＴＥ   ＯＲＩＧＩＮＡＬ  ";
    d.cliente().endereco = { uf: " mg " }; d.cliente().cpfCnpj = "04.252.011/0001-10";
    const antes = d.consultas.length;
    const r = await servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino, { validarDadosDirecionamento: true });
    assert.equal(r.clienteId, 41); assert.equal(r.vendedorId, 31);
    assert.equal(d.consultas.length - antes, 5);
  });
  await t.test("fila histórica mantém destino e snapshot após alteração de nome/UF com a mesma identidade", async () => {
    const { d, servico } = criar(); const ref = await referencia(servico); const original = structuredClone(ref);
    d.cliente().nome = "Marketplace Cliente"; d.cliente().endereco = { uf: "SP" };
    const r = await servico.validarReferenciaPersistidaPedidoManual(usuario, ref, destino, { clienteId: 41, vendedorId: 31 });
    assert.equal(r.clienteId, 41); assert.equal(r.vendedorId, 31);
    assert.deepEqual(ref, original, "a validação da fila não reescreve os dados históricos usados pela regra");
  });
  await t.test("mesmo aplicativo usa IDs locais e rejeita referência forjada", async () => {
    const { servico } = criar(); const ref = await referencia(servico);
    const r = await servico.resolverCorrespondenciaPedidoManual(usuario, ref, origem);
    assert.equal(r.clienteId, 21); assert.equal(r.vendedorId, 11);
    const falsa: ReferenciaPedidoManual = { ...ref, vendedor: { ...ref.vendedor, cpfCnpj: "OUTRO" } };
    await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, falsa, destino), /vendedor de referência/);
  });
  await t.test("orçamento total impede uma expansão de consultas pelos códigos de contato", async () => {
    const { d, servico } = criar(); d.vinculos.clear(); const ref = await referencia(servico);
    for (let i = 0; i < 20; i++) d.contatos.get(destino)!.push({ id: 500 + i, nome: "Ana", codigo: `EXTRA-${i}`, cpfCnpj: docVendedor, situacao: "A" });
    const antes = d.consultas.length;
    await assert.rejects(servico.resolverCorrespondenciaPedidoManual(usuario, ref, destino), /dentro do limite/);
    assert.equal(d.consultas.length - antes, 12);
  });
  await t.test("adaptador padrão limita GET, usa clientes compartilhados e trata 429 sem retry ou exposição", async st => {
    const d = dados();
    Object.assign(bancoSimulado, {
      aplicativo: {
        findMany: async () => d.aplicativos,
        findFirst: async ({ where }: { where: { id: string } }) => d.aplicativos.find(a => a.id === where.id),
        findUnique: async () => ({ olistClientId: "fake", olistClientSecret: "fake" }),
      },
      usuarioVendedorOlist: { findFirst: async () => null },
      integracaoOlistToken: { findUnique: async ({ where }: { where: { aplicativoId_provider: { aplicativoId: string } } }) =>
        ({ accessToken: where.aplicativoId_provider.aplicativoId, expiresAt: new Date(Date.now() + 3600_000) }) },
    });
    let bloquear = false, requisicoes = 0;
    st.mock.method(axios, "get", async (url: string, config: { timeout: number; signal: AbortSignal; maxRedirects: number; maxContentLength: number; headers: { Authorization: string } }) => {
      requisicoes++;
      const u = new URL(url);
      assert.equal(u.origin, "https://api.tiny.com.br"); assert.ok(u.pathname.startsWith("/public-api/v3/"));
      assert.ok(config.timeout > 0 && config.timeout <= 5000); assert.equal(config.signal.aborted, false);
      assert.equal(config.maxRedirects, 0); assert.equal(config.maxContentLength, 512 * 1024);
      const caminho = u.pathname.replace("/public-api/v3/", "") as "contatos" | "vendedores" | `contatos/${number}`;
      const data = bloquear ? { token: "segredo" } : await d.deps.consultar(config.headers.Authorization.slice(7), caminho, Object.fromEntries(u.searchParams), config.timeout);
      return { status: bloquear ? 429 : 200, data, headers: { "content-type": "application/json" } };
    });
    const padrao = criarServicoCorrespondenciaPedidoManual();
    assert.equal((await padrao.obterReferenciaPedidoManual(usuario, entrada)).cliente.id, 21);
    bloquear = true; const antes = requisicoes;
    await assert.rejects(padrao.obterReferenciaPedidoManual(usuario, entrada), (error: unknown) =>
      error instanceof Error && /Limite de consultas/.test(error.message) && !error.message.includes("segredo"));
    assert.equal(requisicoes - antes, 1);
  });
});
