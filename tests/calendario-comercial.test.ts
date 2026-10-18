import assert from "node:assert/strict";
import test from "node:test";
import { catalogoComercial } from "../src/lib/calendario-comercial/catalogo";
import { consultarCatalogoAutorizado } from "../src/lib/calendario-comercial/acesso";
import { escreverFiltros, filtrarEventos, mesAtualBrasil, lerFiltros, montarPlanejamento, resolverOcorrencia, type Evento, type Filtros } from "../src/lib/calendario-comercial/planejamento";
import { paginasPermitidas } from "../src/lib/navigation";
const filtros: Filtros = { visao: "mensal", regioes: ["Nacional"], produto: "", categoria: "", busca: "", mes: 10, etapa: "acontecendo" };
const evento = (id: string) => { const e = catalogoComercial.find((e) => e.id === id); assert.ok(e); return e; };
const ids = (itens: { evento: Evento }[]) => itens.map((o) => o.evento.id);

test("calendário fixo tem doze meses e nenhum ano na URL", () => {
  assert.equal(montarPlanejamento(catalogoComercial, filtros).length, 12);
  const params = new URLSearchParams(escreverFiltros(filtros));
  assert.equal(params.has("ano"), false);
  assert.equal(lerFiltros(new URLSearchParams("ano=2040"), 10).mes, 10);
});
test("datas fixas e regras de domingo não exibem ano", () => {
  assert.equal(resolverOcorrencia(evento("natal")).periodo, "25/12");
  assert.equal(resolverOcorrencia(evento("maes")).periodo, "2º domingo de maio");
  assert.equal(resolverOcorrencia(evento("cirio")).periodo, "2º domingo de outubro");
});
test("datas móveis usam janelas indicativas, nunca dias fixos de outro ano", () => {
  for (const [id, meses] of [["carnaval", [2, 3]], ["pascoa", [3, 4]], ["corpus", [5, 6]], ["marabaixo", [3, 4, 5, 6]], ["advento", [11, 12]]] as const) {
    const o = resolverOcorrencia(evento(id));
    assert.deepEqual(o.meses, [...meses]);
    assert.ok(o.variavel);
    assert.ok(!/\d{4}|\d{2}\/\d{2}/.test(o.periodo));
  }
});
test("cadastro anterior a temporada contínua não se repete", () => {
  const meses = montarPlanejamento(catalogoComercial, filtros);
  assert.ok(ids(meses[4].cadastrar).includes("juninas"));
  assert.ok(!ids(meses[5].cadastrar).includes("juninas"));
  assert.ok(ids(meses[5].acontecendo).includes("juninas"));
  assert.ok(ids(meses[6].acontecendo).includes("juninas"));
});
test("janelas móveis geram preparação antes do primeiro mês possível", () => {
  const meses = montarPlanejamento(catalogoComercial, filtros);
  assert.ok(ids(meses[0].cadastrar).includes("carnaval"));
  assert.ok(ids(meses[1].cadastrar).includes("pascoa"));
  assert.ok(!ids(meses[2].cadastrar).includes("pascoa"));
});
test("ciclo de dezembro a janeiro não duplica coleção nem perde divulgação", () => {
  const meses = montarPlanejamento(catalogoComercial, filtros);
  assert.ok(ids(meses[11].cadastrar).includes("reis"));
  assert.ok(ids(meses[10].cadastrar).includes("verao"));
  assert.ok(ids(meses[0].divulgar).includes("verao"));
  assert.ok(ids(meses[1].acontecendo).includes("verao"));
  assert.ok(!ids(meses[0].cadastrar).includes("verao"));
  assert.equal(meses[0].divulgar.filter((o) => o.evento.id === "verao").length, 1);
});
test("conscientização divulga no próprio mês e anterior é respeitado", () => {
  const meses = montarPlanejamento(catalogoComercial, filtros);
  assert.ok(!ids(meses[8].divulgar).includes("outubro-rosa"));
  assert.ok(ids(meses[9].divulgar).includes("outubro-rosa"));
  const anterior = montarPlanejamento([{ ...evento("natal"), divulgacao: "anterior" }], filtros);
  assert.equal(anterior[10].divulgar.length, 1);
  assert.equal(anterior[11].divulgar.length, 0);
});
test("eventos locais de referência mantêm aviso de confirmação", () => {
  assert.ok(resolverOcorrencia(evento("barretos")).referencia);
  assert.ok(resolverOcorrencia(evento("penha")).referencia);
});
test("filtros combinados e múltiplas regiões não duplicam nacionais", () => {
  assert.deepEqual(filtrarEventos(catalogoComercial, { ...filtros, regioes: ["Nacional", "Norte"], produto: "Painéis", categoria: "Religioso", busca: "nazare" }).map((e) => e.id), ["cirio"]);
  const meses = montarPlanejamento([...catalogoComercial, evento("carnaval")], { ...filtros, regioes: ["Nacional", "Norte", "Sul", "Sudeste"] });
  assert.equal(meses[1].acontecendo.filter((o) => o.evento.id === "carnaval").length, 1);
  assert.ok(ids(meses[7].acontecendo).includes("barretos"));
  assert.equal(filtrarEventos(catalogoComercial, { ...filtros, busca: "inexistente" }).length, 0);
});
test("URL preserva mês, etapa e filtros e descarta valores inválidos", () => {
  const f: Filtros = { ...filtros, regioes: ["Nacional", "Norte", "Sul"], mes: 6, etapa: "cadastrar", busca: "São José" };
  assert.deepEqual(lerFiltros(new URLSearchParams(escreverFiltros(f)), 10), f);
  assert.deepEqual(lerFiltros(new URLSearchParams("mes=13&etapa=outra&regiao=Norte&regiao=Norte&produto=Outro"), 10), { ...filtros, regioes: ["Nacional", "Norte"] });
});
test("mês atual respeita fuso de São Paulo", () => {
  assert.equal(mesAtualBrasil(new Date("2027-01-01T01:00:00Z")), 12);
});
test("catálogo possui IDs únicos, fontes HTTPS e as cinco abrangências", () => {
  assert.equal(new Set(catalogoComercial.map((e) => e.id)).size, catalogoComercial.length);
  assert.equal(new Set(catalogoComercial.flatMap((e) => e.regioes)).size, 5);
  for (const e of catalogoComercial) {
    assert.ok(e.produtos.length && e.fontes.length && e.recomendacao && e.estampas);
    for (const f of e.fontes) assert.equal(new URL(f.url).protocol, "https:");
  }
});
test("servidor não carrega catálogo sem token, usuário ativo e permissão", async () => {
  let carregou = 0;
  const carregar = () => { carregou++; return catalogoComercial; };
  const proibido = async () => ({ ativo: true, podeVisualizarTarefasMidia: false });
  assert.equal((await consultarCatalogoAutorizado(null, { autenticar: async () => { throw new Error("Não deveria autenticar"); }, carregar })).ok, false);
  assert.equal((await consultarCatalogoAutorizado("token", { autenticar: proibido, carregar })).ok, false);
  assert.equal((await consultarCatalogoAutorizado("token", { autenticar: async () => ({ ativo: false, podeVisualizarTarefasMidia: true }), carregar })).ok, false);
  assert.equal(carregou, 0);
  const autorizado = await consultarCatalogoAutorizado("token", { autenticar: async () => ({ ativo: true, podeVisualizarTarefasMidia: true }), carregar });
  assert.ok(autorizado.ok);
  assert.equal(carregou, 1);
});
test("erro de autenticação é genérico e não expõe dados internos", async () => {
  const resultado = await consultarCatalogoAutorizado("token", { autenticar: async () => { throw new Error("credencial-secreta"); }, carregar: () => catalogoComercial });
  assert.ok(!resultado.ok);
  assert.ok(!JSON.stringify(resultado).includes("credencial-secreta"));
});
test("menu usa permissão existente e não concede acesso por outra permissão", () => {
  assert.ok(paginasPermitidas({ podeVisualizarTarefasMidia: true }).some((p) => p.href === "/controle-midia/calendario"));
  assert.ok(!paginasPermitidas({ podeVisualizarCategoriasMidia: true }).some((p) => p.href === "/controle-midia/calendario"));
});

test("revisão: Penha alcança maio e Pentecostes fica em maio ou junho", () => {
  assert.deepEqual(resolverOcorrencia(evento("penha")).meses, [3, 4, 5]);
  assert.deepEqual(resolverOcorrencia(evento("divino")).meses, [5, 6]);
  const meses = montarPlanejamento(catalogoComercial, { ...filtros, regioes: ["Nacional", "Sudeste"] });
  assert.ok(ids(meses[4].acontecendo).includes("penha"));
  assert.ok(ids(meses[3].cadastrar).includes("divino"));
});
test("revisão: vaquejadas são linha permanente sem cadastro sazonal artificial", () => {
  const meses = montarPlanejamento(catalogoComercial, { ...filtros, regioes: ["Nacional", "Nordeste"] });
  for (const mes of meses) {
    assert.ok(ids(mes.acontecendo).includes("vaquejadas"));
    assert.ok(ids(mes.divulgar).includes("vaquejadas"));
    assert.ok(!ids(mes.cadastrar).includes("vaquejadas"));
  }
  assert.equal(resolverOcorrencia(evento("vaquejadas")).periodo, "Ao longo do ano · confirmar agenda local");
});
test("revisão: campanha de autismo abrange abril e mantém o marco de 02/04", () => {
  const o = resolverOcorrencia(evento("autismo"));
  assert.deepEqual(o.meses, [4]);
  assert.equal(o.periodo, "Abril");
  assert.ok(o.evento.recomendacao.includes("2 de abril"));
});
test("revisão: festas regionais novas não vazam para a visão nacional", () => {
  for (const id of ["santana-caico", "cirandas-manacapuru", "saire"]) {
    assert.ok(!filtrarEventos(catalogoComercial, filtros).some((e) => e.id === id));
    assert.ok(resolverOcorrencia(evento(id)).referencia);
  }
  const norte = montarPlanejamento(catalogoComercial, { ...filtros, regioes: ["Nacional", "Norte"] });
  assert.ok(ids(norte[8].acontecendo).includes("saire"));
  assert.ok(ids(norte[7].cadastrar).includes("saire"));
  assert.ok(ids(norte[7].acontecendo).includes("cirandas-manacapuru"));
  const nordeste = montarPlanejamento(catalogoComercial, { ...filtros, regioes: ["Nacional", "Nordeste"] });
  assert.ok(ids(nordeste[6].acontecendo).includes("santana-caico"));
});
test("revisão: tradições em 26 e 27/09 são registros distintos com fontes específicas", () => {
  assert.equal(resolverOcorrencia(evento("cosme-catolico")).periodo, "26/09");
  assert.equal(resolverOcorrencia(evento("cosme-popular")).periodo, "27/09");
  assert.ok(evento("cosme-catolico").fontes.some((f) => f.url.includes("vaticannews.va")));
  assert.ok(evento("cosme-popular").recomendacao.includes("comunidades católicas locais"));
});

test("todo evento tem nível e justificativa de compra, respeitando o público", () => {
  for (const e of catalogoComercial) {
    assert.ok(e.potencialCompra, e.id);
    assert.ok(["Muito alto", "Alto", "Moderado", "Baixo"].includes(e.potencialCompra.nivel));
    assert.ok(e.potencialCompra.justificativa.length > 30);
  }
  assert.equal(evento("natal").potencialCompra.nivel, "Muito alto");
  assert.equal(evento("barretos").potencialCompra.publico, "Regional/local");
  assert.equal(evento("autismo").potencialCompra.publico, "Institucional");
});


test("visualização mensal é padrão; anual é compartilhável e não altera filtros", () => {
  assert.equal(lerFiltros(new URLSearchParams(), 10).visao, "mensal");
  assert.equal(lerFiltros(new URLSearchParams("visao=outra"), 10).visao, "mensal");
  const anual: Filtros = { ...filtros, visao: "anual", mes: 6, regioes: ["Nacional", "Nordeste"], busca: "juninas" };
  assert.deepEqual(lerFiltros(new URLSearchParams(escreverFiltros(anual)), 10), anual);
  assert.equal(new URLSearchParams(escreverFiltros({ ...anual, visao: "mensal" })).has("visao"), false);
  assert.deepEqual(montarPlanejamento(catalogoComercial, anual), montarPlanejamento(catalogoComercial, { ...anual, visao: "mensal" }));
});
