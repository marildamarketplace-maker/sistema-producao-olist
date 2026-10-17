import assert from "node:assert/strict";
import test from "node:test";
import { catalogoComercial } from "../src/lib/calendario-comercial/catalogo";
import { consultarCatalogoAutorizado } from "../src/lib/calendario-comercial/acesso";
import { escreverFiltros, filtrarEventos, formatarPeriodo, hojeBrasil, lerFiltros, montarPlanejamento, resolverOcorrencia, type Evento, type Filtros } from "../src/lib/calendario-comercial/planejamento";
import { paginasPermitidas } from "../src/lib/navigation";
const filtros: Filtros = { ano: 2027, regioes: ["Nacional"], produto: "", categoria: "", busca: "" };
const evento = (id: string) => {
  const e = catalogoComercial.find((e) => e.id === id);
  assert.ok(e, id); return e;
};
const ids = (itens: { evento: Evento }[]) => itens.map((o) => o.evento.id);

test("datas móveis de 2027 e 2028 são calculadas anualmente", () => {
  for (const [id, dia] of Object.entries({ carnaval: "2027-02-09", pascoa: "2027-03-28", corpus: "2027-05-27", maes: "2027-05-09", pais: "2027-08-08", cirio: "2027-10-10" })) {
    assert.equal(resolverOcorrencia(evento(id), 2027).inicio, dia);
  }
  assert.equal(resolverOcorrencia(evento("pascoa"), 2028).inicio, "2028-04-16");
  assert.equal(resolverOcorrencia(evento("carnaval"), 2028).inicio, "2028-02-29");
});
test("Advento começa no quarto domingo antes do Natal e termina em 24/12", () => {
  assert.equal(resolverOcorrencia(evento("advento"), 2027).inicio, "2027-11-28");
  assert.equal(resolverOcorrencia(evento("advento"), 2028).inicio, "2028-12-03");
  assert.equal(resolverOcorrencia(evento("advento"), 2028).fim, "2028-12-24");
});
test("cadastro ocorre no mês anterior inteiro e juninas contínuas não repetem cadastro", () => {
  const meses = montarPlanejamento(catalogoComercial, filtros);
  assert.ok(ids(meses[4].cadastrar).includes("juninas"));
  assert.ok(!ids(meses[5].cadastrar).includes("juninas"));
  assert.ok(ids(meses[5].acontecendo).includes("juninas"));
  assert.ok(ids(meses[6].acontecendo).includes("juninas"));
  assert.ok(ids(meses[4].divulgar).includes("maes"));
  assert.ok(ids(meses[4].divulgar).includes("juninas"));
});
test("cadastro de janeiro seguinte aparece em dezembro; verão mantém divulgação de ano anterior", () => {
  const meses = montarPlanejamento(catalogoComercial, filtros);
  const reis = meses[11].cadastrar.find((o) => o.evento.id === "reis");
  assert.equal(reis?.inicio, "2028-01-06");
  const verao = meses[0].divulgar.find((o) => o.evento.id === "verao");
  assert.equal(verao?.inicio, "2026-12-01");
  assert.equal(verao?.fim, "2027-02-28");
  assert.ok(!ids(meses[0].cadastrar).includes("verao"));
});
test("períodos respeitam fevereiro bissexto e divulgação apenas no período", () => {
  const ocorrencia = resolverOcorrencia(evento("verao"), 2027);
  assert.equal(ocorrencia.fim, "2028-02-29");
  const meses = montarPlanejamento(catalogoComercial, filtros);
  assert.ok(!ids(meses[8].divulgar).includes("outubro-rosa"));
  assert.ok(ids(meses[9].divulgar).includes("outubro-rosa"));
  assert.ok(ids(meses[8].cadastrar).includes("outubro-rosa"));
});
test("regra de divulgação apenas anterior não se prolonga até o evento", () => {
  const meses = montarPlanejamento([{ ...evento("natal"), divulgacao: "anterior" }], filtros);
  assert.equal(meses[10].divulgar.length, 1);
  assert.equal(meses[11].divulgar.length, 0);
});
test("eventos de referência não recebem dia exato e exibem aviso de confirmação", () => {
  const o = resolverOcorrencia(evento("barretos"), 2027);
  assert.ok(o.referencia);
  assert.equal(formatarPeriodo(o), "Agosto de 2027");
  assert.ok(resolverOcorrencia(evento("penha"), 2027).referencia);
  assert.equal(resolverOcorrencia(evento("penha"), 2027).inicio, "2027-03-28");
});
test("filtros combinam região, produto, categoria e busca sem acentos", () => {
  assert.deepEqual(filtrarEventos(catalogoComercial, { ...filtros, regioes: ["Nacional", "Norte"], produto: "Painéis", categoria: "Religioso", busca: "nazare" }).map((e) => e.id), ["cirio"]);
  assert.equal(filtrarEventos(catalogoComercial, { ...filtros, busca: "parintins" }).length, 0);
  assert.equal(filtrarEventos(catalogoComercial, { ...filtros, busca: "não existe" }).length, 0);
});
test("regiões incluem nacionais e múltiplas seleções não duplicam eventos", () => {
  const meses = montarPlanejamento([...catalogoComercial, evento("carnaval")], { ...filtros, regioes: ["Nacional", "Nordeste", "Norte", "Sul", "Sudeste"] });
  assert.equal(meses[1].acontecendo.filter((o) => o.evento.id === "carnaval").length, 1);
  assert.ok(ids(meses[7].acontecendo).includes("barretos"));
  assert.ok(ids(meses[9].acontecendo).includes("cirio"));
});
test("URL preserva filtros e normaliza valores inválidos e regiões duplicadas", () => {
  const f: Filtros = { ...filtros, regioes: ["Nacional", "Norte", "Sul"], produto: "Lenços", categoria: "Religioso", busca: "São José" };
  assert.deepEqual(lerFiltros(new URLSearchParams(escreverFiltros(f)), 2027), f);
  assert.deepEqual(lerFiltros(new URLSearchParams("ano=3000&regiao=Norte&regiao=Norte&regiao=Outro&produto=Outro&categoria=Outro"), 2027), { ...filtros, regioes: ["Nacional", "Norte"] });
  assert.equal(lerFiltros(new URLSearchParams("ano=2026"), 2027).ano, 2026);
  assert.equal(lerFiltros(new URLSearchParams("ano=2029"), 2027).ano, 2029);
});
test("hoje usa São Paulo mesmo na virada de ano em UTC", () => {
  assert.deepEqual(hojeBrasil(new Date("2027-01-01T01:00:00Z")), { ano: 2026, mes: 12 });
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
