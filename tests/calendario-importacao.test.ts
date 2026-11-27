import assert from "node:assert/strict";
import test from "node:test";
import { entradaImportacaoSchema, lerCsvAssociacoes, prepararImportacao, type EntradaImportacao } from "../src/lib/calendario-comercial/importacao";
const linha = (sku = "001", principal = "natal", tipo = "Direta", adicionais = "advento") => ({ registro: 2, sku, principal, tipo, adicionais });
const entrada = (linhas: EntradaImportacao["linhas"]): EntradaImportacao => ({ linhas, incluirAdicionais: false, incluirSugestoes: false });
const deps = { produtos: async (skus: string[]) => skus.filter(s => s !== "ausente").map(sku => ({ id: sku, sku, ativo: sku !== "inativo" })), existentes: async () => [] };

test("CSV preserva SKU, aspas, delimitador, multiline e cabeçalhos com acentos/BOM", () => {
  assert.deepEqual(lerCsvAssociacoes('\ufeffSKU;Evento principal ID;Tipo associação;Nome\r\n001;natal;Direta;"Nome; com ""aspas""\ncontinuação"\r\n'), [{...linha(), adicionais:""}]);
  assert.deepEqual(lerCsvAssociacoes('SKU,Evento principal ID\n001,natal\n'), [{...linha(), adicionais:""}]);
});
test("CSV recusa estrutura ambígua, malformada ou grande", () => {
  for (const csv of ['SKU;SKU;Evento principal ID\na;b;natal', 'SKU;Nome\na;X', 'SKU;Evento principal ID\na;"natal', 'SKU;Evento principal ID\na;"natal"x', 'SKU;Evento principal ID\na;natal;extra', 'SKU;Evento principal ID\n']) assert.throws(() => lerCsvAssociacoes(csv));
  assert.throws(() => lerCsvAssociacoes('SKU;Evento principal ID\n' + 'a;natal\n'.repeat(5001)), /5.000/);
  assert.equal(entradaImportacaoSchema.safeParse({...entrada([linha()]), aplicativoId:"alheio"}).success, false);
});
test("prévia padrão exclui sugestões e registros sem evento; extras exigem opção", async () => {
  const dados = entrada([linha(), linha("002","natal","Sugestão comercial"), linha("003","","Sem evento específico no calendário")]);
  const r = await prepararImportacao(dados, deps);
  assert.deepEqual(r.vinculos, [{sku:"001",eventoId:"natal",existente:false}]); assert.equal(r.ignorados,2);
  const completo = await prepararImportacao({...dados,incluirSugestoes:true,incluirAdicionais:true}, deps);
  assert.equal(completo.vinculos.length,4); assert.equal(completo.ignorados,1);
});
test("prévia recusa desconhecidos e inativos, deduplica e identifica vínculos já salvos", async () => {
  const r = await prepararImportacao(entrada([linha(),linha(),linha("ausente"),linha("inativo"),linha("002","inexistente"),linha("003","natal","invalido")]), {
    ...deps, existentes: async pares => { assert.deepEqual(pares,[{produtoId:"001",eventoId:"natal"}]); return pares; },
  });
  assert.deepEqual(r.vinculos,[{sku:"001",eventoId:"natal",existente:true}]); assert.equal(r.duplicados,1);assert.equal(r.totalProblemas,4);
});
test("prévia limita relatório sem perder contagem e não lê banco sem candidatos", async () => {
  const r = await prepararImportacao(entrada(Array.from({length:120},(_,i)=>({...linha("x","errado"),registro:i+2}))), {
    produtos:async()=>assert.fail(),existentes:async()=>assert.fail(),
  });
  assert.equal(r.totalProblemas,120);assert.equal(r.problemas.length,100);
});
test("evento adicional inválido é sinalizado sem criar vínculo arbitrário", async () => {
  const r = await prepararImportacao({...entrada([linha("001","natal","Direta","advento | estranho")]),incluirAdicionais:true},deps);
  assert.deepEqual(r.vinculos.map(v=>v.eventoId),["natal","advento"]);assert.equal(r.totalProblemas,1);
});
