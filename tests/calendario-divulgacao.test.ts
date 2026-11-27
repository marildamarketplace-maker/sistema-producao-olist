import assert from "node:assert/strict";
import test from "node:test";
import { consultarDivulgacao, eventosParaDivulgar, filtrosDivulgacaoSchema, type UsuarioDivulgacao } from "../src/lib/calendario-comercial/divulgacao";
import { montarConsultaDivulgacao, serializarPaginaDivulgacao } from "../src/lib/calendario-comercial/divulgacao-consulta";

const app="00000000-0000-4000-8000-000000000001";
const usuario: UsuarioDivulgacao={ativo:true,aplicativoId:app,podeVisualizarTarefasMidia:true,podeVisualizarEstoque:true,podeEditarEstoque:false};
const vazio={produtos:[],temMais:false,referenciaEm:"2026-11-27T12:00:00.000Z",inicioEm:"2025-11-27T12:00:00.000Z"};
test("novembro inclui Natal antecipado e respeita a região sem duplicar nacionais",()=>{
  const nacional=eventosParaDivulgar({mes:11,regiao:"Nacional",pagina:0});
  assert.ok(nacional.some(e=>e.id==="natal"&&e.peso===2));
  assert.ok(nacional.some(e=>e.id==="primavera"&&e.peso===2.08&&e.ultimoMes));
  const regional=eventosParaDivulgar({mes:6,regiao:"Norte",pagina:0});
  assert.ok(regional.some(e=>e.id==="parintins"));
  assert.ok(!eventosParaDivulgar({mes:6,regiao:"Nacional",pagina:0}).some(e=>e.id==="parintins"));
  assert.equal(new Set(regional.map(e=>e.id)).size,regional.length);
});
test("janelas mensais: campanha afro encerra em novembro e Natal recebe bônus em dezembro", () => {
  const eventos = (mes: number) => eventosParaDivulgar({ mes, regiao: "Nacional", pagina: 0 });
  assert.ok(eventos(11).some(e => e.id === "consciencia-negra" && e.ultimoMes && e.peso === 1.3));
  assert.ok(!eventos(10).some(e => e.id === "consciencia-negra"));
  assert.ok(!eventos(12).some(e => e.id === "consciencia-negra"));
  assert.ok(eventos(11).some(e => e.id === "natal" && !e.ultimoMes && e.peso === 2));
  assert.ok(eventos(12).some(e => e.id === "natal" && e.ultimoMes && e.peso === 2.6));
  assert.ok(!eventos(1).some(e => e.id === "natal"));
});
test("janela atravessa o ano e eventos permanentes não recebem urgência artificial", () => {
  const eventos = (mes: number) => eventosParaDivulgar({ mes, regiao: "Nordeste", pagina: 0 });
  for (const mes of [12, 1]) assert.equal(eventos(mes).find(e => e.id === "verao")?.ultimoMes, false);
  assert.equal(eventos(2).find(e => e.id === "verao")?.ultimoMes, true);
  for (const mes of [3, 11]) assert.ok(!eventos(mes).some(e => e.id === "verao"));
  for (let mes = 1; mes <= 12; mes++) assert.equal(eventos(mes).find(e => e.id === "vaquejadas")?.ultimoMes, false);
});
test("fronteira recusa filtros arbitrários, mês/região inválidos e paginação excessiva",async()=>{
  for(const entrada of [{mes:11,ordem:"estoque; DROP TABLE produtos"},{mes:0},{mes:13},{mes:11,regiao:"xxx"},{mes:11,pagina:-1},{mes:11,pagina:10001},{mes:11,pagina:0.5},{mes:11,aplicativoId:app},{mes:11,eventos:["juninas"]}]) {
    assert.equal(filtrosDivulgacaoSchema.safeParse(entrada).success,false);
    const retorno=await consultarDivulgacao("token",entrada,{autenticar:async()=>assert.fail(),consultar:async()=>assert.fail()});
    assert.equal(retorno.ok,false);
  }
});
test("sem sessão ou uma das famílias de permissão não há consulta a estoque",async()=>{
  for(const token of ["", "t".repeat(16385)]) {
    assert.equal((await consultarDivulgacao(token,{mes:11},{autenticar:async()=>assert.fail(),consultar:async()=>assert.fail()})).ok,false);
  }
  for(const invalido of [null,{...usuario,ativo:false},{...usuario,aplicativoId:null},{...usuario,podeVisualizarTarefasMidia:false},{...usuario,podeVisualizarEstoque:false}]) {
    const retorno=await consultarDivulgacao("token",{mes:11},{autenticar:async()=>invalido,consultar:async()=>assert.fail("Não deve ler dados protegidos")});
    assert.equal(retorno.ok,false);
  }
});
test("aplicativo e eventos são resolvidos no servidor; edição de estoque também concede leitura",async()=>{
  let consultas=0;
  const retorno=await consultarDivulgacao("token",{mes:11,pagina:2},{
    autenticar:async(token)=>{assert.equal(token,"token");return {...usuario,podeVisualizarEstoque:false,podeEditarEstoque:true};},
    consultar:async(aplicativo,eventos,pagina,ordem)=>{assert.equal(ordem,"prioridade");consultas++;assert.equal(aplicativo,app);assert.equal(pagina,2);assert.ok(eventos.some(e=>e.id==="natal"));return vazio;},
  });
  assert.equal(retorno.ok,true);assert.equal(consultas,1);
});
test("ordenação explícita permite análise por estoque e retorno à prioridade",async()=>{
  for (const ordem of ["estoque_desc", "estoque_asc", "prioridade"] as const) {
    const resultado = await consultarDivulgacao("token", { mes: 11, ordem }, {
      autenticar: async () => usuario,
      consultar: async (_app, _eventos, _pagina, recebida) => { assert.equal(recebida, ordem); return vazio; },
    });
    assert.equal(resultado.ok, true);
  }
});
test("falhas de autenticação ou infraestrutura nunca expõem conteúdo interno",async()=>{
  for(const falhaAuth of [true,false]) {
    const resultado=await consultarDivulgacao("token",{mes:11},{
      autenticar:async()=>{if(falhaAuth)throw new Error("secret SQL postgres://senha");return usuario;},
      consultar:async()=>{throw new Error("secret SQL postgres://senha");},
    });
    assert.equal(resultado.ok,false);
    if(!resultado.ok)assert.doesNotMatch(resultado.erro,/secret|SQL|postgres|senha/);
  }
});
test("SQL parametrizada usa projeção mínima, agregação global antes da página e limite de 21",()=>{
  const referencia=new Date("2026-11-27T12:00:00Z");
  const termo="'); DROP TABLE produtos; --";
  const consulta=montarConsultaDivulgacao(app,[{id:termo,nome:"Teste",potencial:"Baixo",peso:1}],3,referencia);
  assert.doesNotMatch(consulta.text,/DROP TABLE|SELECT \*|imagem_url|observacao|descricao_final/);
  assert.ok(consulta.values.includes(termo));assert.ok(consulta.values.includes(app));
  assert.ok(consulta.values.includes(21));assert.ok(consulta.values.includes(60));
  assert.match(consulta.text,/percentile_disc/);assert.match(consulta.text,/GROUP BY v.id/);
  assert.match(consulta.text,/m.aplicativo_id = \$\d+::uuid/);
  assert.match(consulta.text,/ORDER BY o.posicao ASC LIMIT \$\d+ OFFSET \$\d+/);
  assert.ok(consulta.text.indexOf("LIMIT $",consulta.text.indexOf("pagina AS"))>consulta.text.indexOf("ordenados AS"));
});
test("serialização aceita inteiros exatos e recusa perda de precisão ou contagem negativa",()=>{
  const datas={referenciaEm:new Date(vazio.referenciaEm),inicioEm:new Date(vazio.inicioEm)};
  const linha={...datas,id:app,sku:"SKU",titulo:"Título",estoque:BigInt(12),saidas:"3",perfil:"estoque",eventoPrincipal:"natal",eventos:["natal"]};
  assert.deepEqual(serializarPaginaDivulgacao([linha]).produtos.map(p=>[p.estoque,p.saidas]),[[12,3]]);
  assert.throws(()=>serializarPaginaDivulgacao([{...linha,estoque:BigInt("9007199254740993")}]));
  assert.throws(()=>serializarPaginaDivulgacao([{...linha,saidas:BigInt(-1)}]));
  assert.throws(()=>serializarPaginaDivulgacao([{...linha,estoque:1.5}]));
});
