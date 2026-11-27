import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { criarPostgresMemoria } from "./helpers/postgres-memoria";
import { montarConsultaDivulgacao, serializarPaginaDivulgacao } from "../src/lib/calendario-comercial/divulgacao-consulta";
import type { EventoDivulgacao, OrdemDivulgacao } from "../src/lib/calendario-comercial/divulgacao";

const db = criarPostgresMemoria();
const app = "00000000-0000-4000-8000-000000000001", outroApp = "00000000-0000-4000-8000-000000000002";
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const referencia = new Date("2026-11-27T12:00:00.000Z");
const eventos: EventoDivulgacao[] = [
  { id: "natal", nome: "Natal", peso: 2, potencial: "Muito alto" },
  { id: "advento", nome: "Advento", peso: 1.3, potencial: "Moderado" },
];
before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE public.aplicativo(id uuid PRIMARY KEY);
    CREATE TABLE public.produtos(id uuid PRIMARY KEY, aplicativo_id uuid, sku text NOT NULL, ativo boolean NOT NULL);
    CREATE TABLE public.produto_olist(id uuid PRIMARY KEY, produto_id uuid, titulo_final text, updated_at timestamptz);
    CREATE TABLE public.movimentacoes_estoque(id uuid DEFAULT gen_random_uuid(), produto_id uuid, aplicativo_id uuid,
      tipo_movimento text, quantidade integer, created_at timestamptz, origem text);
    INSERT INTO public.aplicativo VALUES ('${app}'), ('${outroApp}');`);
  await db.exec(await readFile(new URL("../prisma/migrations/20261127130000_calendario_produtos/migration.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../prisma/migrations/20261127160000_produtos_titulo/migration.sql", import.meta.url), "utf8"));
});
beforeEach(async () => { await db.exec("TRUNCATE public.movimentacoes_estoque, public.produto_olist, public.calendario_evento_produtos, public.produtos CASCADE"); });
after(async () => { await db.close(); });
async function produto(n: number, op: { app?: string; eventos?: string[]; ativo?: boolean } = {}) {
  const aplicativo = op.app ?? app;
  await db.query("INSERT INTO produtos (id,aplicativo_id,sku,ativo) VALUES ($1,$2,$3,$4)", [uuid(n), aplicativo, `SKU-${String(n).padStart(4,"0")}`, op.ativo ?? true]);
  for (const evento of op.eventos ?? ["natal"]) await db.query("INSERT INTO calendario_evento_produtos(aplicativo_id,evento_id,produto_id) VALUES($1,$2,$3)", [aplicativo, evento, uuid(n)]);
}
async function movimento(n: number, tipo: string, quantidade: number, data = "2026-10-01T12:00:00Z", aplicativo = app, origem = "AJUSTE_PRODUCAO") {
  await db.query("INSERT INTO movimentacoes_estoque(produto_id,aplicativo_id,tipo_movimento,quantidade,created_at,origem) VALUES ($1,$2,$3,$4,$5,$6)", [uuid(n), aplicativo, tipo, quantidade, data, origem]);
}
async function consultar(pagina = 0, ref = referencia, listaEventos = eventos, ordem: OrdemDivulgacao = "prioridade") {
  const sql = montarConsultaDivulgacao(app, listaEventos, pagina, ref, ordem);
  const { rows } = await db.query(sql.text, sql.values);
  return serializarPaginaDivulgacao(rows);
}
test("PostgreSQL: ordena estoque antes de paginar em ambas as direções e mantém indisponíveis no fim", async () => {
  for (let n = 1; n <= 25; n++) { await produto(n); await movimento(n, "entrada", n); }
  await produto(26); await produto(27); await movimento(27, "saida", 3);
  for (const ordem of ["estoque_desc", "estoque_asc"] as const) {
    const primeira = await consultar(0, referencia, eventos, ordem);
    const segunda = await consultar(1, referencia, eventos, ordem);
    const produtos = [...primeira.produtos, ...segunda.produtos];
    const positivos = Array.from({ length: 25 }, (_, i) => ordem === "estoque_desc" ? 25 - i : i + 1);
    assert.deepEqual(produtos.map(p => p.estoque), [...positivos, ...(ordem === "estoque_desc" ? [0, -3] : [-3, 0])]);
    assert.equal(new Set(produtos.map(p => p.id)).size, 27);
    assert.equal(primeira.temMais, true); assert.equal(segunda.temMais, false);
  }
});
test("PostgreSQL: título importado tem prioridade e título gerado permanece como fallback", async () => {
  await produto(1); await produto(2); await produto(3);
  await db.query("UPDATE produtos SET titulo=$1 WHERE id=$2", ["  Forro Natal ERP  ", uuid(1)]);
  await db.query("UPDATE produtos SET titulo='   ' WHERE id=$1", [uuid(2)]);
  await db.query("INSERT INTO produto_olist VALUES ($1,$2,'Gerado','2026-01-01'),($3,$4,'Alternativo','2026-01-01')", [uuid(1001),uuid(1),uuid(1002),uuid(2)]);
  const dados = await consultar();
  assert.deepEqual(dados.produtos.map(p => p.titulo), ["Forro Natal ERP", "Alternativo", "Sem título"]);
});
test("PostgreSQL: saldo histórico, contagem por registro, todas as origens e vínculos deduplicados", async () => {
  await produto(1, { eventos: ["natal", "advento"] });
  await movimento(1,"entrada",100,"2020-01-01T00:00Z");
  await movimento(1,"saida",5,"2024-01-01T00:00Z");
  await movimento(1,"saida",50,undefined,app,"TROCA_SKU_BAIXA_OLIST");
  await movimento(1,"saida",9,undefined,outroApp);
  await movimento(1,"entrada",999,"2027-01-01T00:00Z");
  await db.query("INSERT INTO produto_olist VALUES ($1,$2,'Antigo','2026-01-01'),($3,$2,'Título atual','2026-02-01')", [uuid(1001),uuid(1),uuid(1002)]);
  const dados = await consultar();
  assert.equal(dados.produtos.length,1);
  assert.deepEqual(dados.produtos[0], { id: uuid(1), sku:"SKU-0001", titulo:"Título atual", estoque:45, saidas:1,
    perfil:"estoque", eventoPrincipal:"natal", eventos:["natal","advento"] });
  assert.equal(dados.inicioEm,"2025-11-27T12:00:00.000Z");
});
test("PostgreSQL: janela inclusiva/exclusiva e 12 meses de calendário em ano bissexto", async () => {
  await produto(1);
  await movimento(1,"entrada",100,"2020-01-01T00:00Z");
  await movimento(1,"saida",1,"2025-11-27T11:59:59.999Z");
  await movimento(1,"saida",1,"2025-11-27T12:00:00.000Z");
  await movimento(1,"saida",1,"2026-11-27T11:59:59.999Z");
  await movimento(1,"saida",1,"2026-11-27T12:00:00.000Z");
  const dados = await consultar();
  assert.equal(dados.produtos[0].saidas,2); assert.equal(dados.produtos[0].estoque,97);
  const bissexto = await consultar(0,new Date("2024-02-29T12:00:00Z"));
  assert.equal(bissexto.inicioEm,"2023-02-28T12:00:00.000Z");
});
test("PostgreSQL: não mistura aplicativos, inativos, produtos sem vínculo ou eventos não selecionados", async () => {
  await produto(1); await produto(2,{app:outroApp}); await produto(3,{ativo:false});
  await produto(4,{eventos:[]}); await produto(5,{eventos:["juninas"]});
  const dados = await consultar();
  assert.deepEqual(dados.produtos.map(p=>p.id),[uuid(1)]);
  assert.equal(dados.produtos[0].titulo,"Sem título");
  assert.equal(dados.produtos[0].estoque,0); assert.equal(dados.produtos[0].perfil,"sem_estoque");
  await assert.rejects(db.query("INSERT INTO calendario_evento_produtos VALUES ($1,'natal',$2,now())", [outroApp,uuid(1)]), /foreign key/i);
  const duplicado = db.query("INSERT INTO calendario_evento_produtos VALUES ($1,'natal',$2,now())", [app,uuid(1)]);
  await assert.rejects(duplicado,/duplicate key/i);
});
test("PostgreSQL: corte corrigido não esvazia o perfil de mais saídas com mediana no máximo", async () => {
  for (const [indice, saidas] of [2,10,10,10].entries()) {
    const n=indice+1; await produto(n); await movimento(n,"entrada",100);
    for (let i=0;i<saidas;i++) await movimento(n,"saida",1);
  }
  const dados=await consultar();
  assert.equal(dados.produtos.filter(p=>p.perfil==="estoque").length,1);
  assert.equal(dados.produtos.filter(p=>p.perfil==="saidas").length,3);
  assert.equal(dados.produtos[0].id,uuid(1));
});
test("PostgreSQL: ranking global mantém 12/8, não duplica entre páginas e deixa zero/negativos no fim", async () => {
  for(let n=1;n<=42;n++) {
    await produto(n,{eventos:n%2 ? ["natal","advento"]:["advento"]});
    await movimento(n,"entrada",n<=24?100+n:200);
    if(n>24 && n<=40) for(let i=0;i<10;i++) await movimento(n,"saida",1);
    if(n===41) await movimento(n,"saida",200);
    if(n===42) await movimento(n,"saida",205);
  }
  const p1=await consultar(), p2=await consultar(1), p3=await consultar(2);
  for(const p of [p1,p2]) {
    assert.equal(p.produtos.filter(p=>p.perfil==="estoque").length,12);
    assert.equal(p.produtos.filter(p=>p.perfil==="saidas").length,8);
    assert.equal(p.temMais,true);
  }
  const todos=[...p1.produtos,...p2.produtos,...p3.produtos];
  assert.equal(new Set(todos.map(p=>p.id)).size,42);
  assert.deepEqual(p3.produtos.map(p=>p.estoque),[0,-5]);
  assert.equal(p3.temMais,false);
  assert.deepEqual((await consultar()).produtos,p1.produtos);
});
test("PostgreSQL: empate completo usa apenas o perfil disponível e evento único não deixa lacunas", async () => {
  for(let n=1;n<=25;n++){await produto(n);await movimento(n,"entrada",n);}
  const dados=await consultar();
  assert.ok(dados.produtos.every(p=>p.perfil==="estoque"));
  assert.deepEqual(dados.produtos.map(p=>p.estoque),Array.from({length:20},(_,i)=>25-i));
  assert.equal(dados.temMais,true);
});
test("PostgreSQL: distribuição moderada entre eventos é aplicada antes da paginação", async () => {
  for(let n=1;n<=60;n++){await produto(n,{eventos:[n<=30?"natal":"advento"]});await movimento(n,"entrada",100);}
  const dados=await consultar();
  const natal=dados.produtos.filter(p=>p.eventoPrincipal==="natal").length;
  assert.ok(natal>10 && natal<16, `Participação inesperada: ${natal}`);
  assert.deepEqual(dados.produtos.slice(0,2).map(p=>p.eventoPrincipal),["natal","advento"]);
});
test("PostgreSQL: vazio, eventos vazios e página esgotada preservam metadados sem linhas falsas", async () => {
  for(const dados of [await consultar(),await consultar(0,referencia,[]),await consultar(999)]){
    assert.deepEqual(dados.produtos,[]);assert.equal(dados.temMais,false);
    assert.equal(dados.referenciaEm,referencia.toISOString());
  }
});
test("PostgreSQL: falta de um perfil completa as posições sem esconder produtos", async () => {
  for(let n=1;n<=22;n++) {
    await produto(n); await movimento(n,"entrada",100);
    for(let i=0;i<(n<=2?0:1);i++)await movimento(n,"saida",1);
  }
  const dados=await consultar();
  assert.equal(dados.produtos.filter(p=>p.perfil==="estoque").length,2);
  assert.equal(dados.produtos.filter(p=>p.perfil==="saidas").length,18);
  assert.equal(new Set(dados.produtos.map(p=>p.id)).size,20);
});
test("PostgreSQL: plano de execução e resposta limitada em universo sintético com histórico", async () => {
  await db.exec(`INSERT INTO produtos(id,aplicativo_id,sku,ativo)
    SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${app}', 'ESCALA-'||lpad(n::text,6,'0'),true FROM generate_series(1,1000)n;
    INSERT INTO calendario_evento_produtos(aplicativo_id,evento_id,produto_id)
    SELECT aplicativo_id, CASE WHEN right(sku,1) IN ('0','1','2','3','4') THEN 'natal' ELSE 'advento' END,id FROM produtos;
    INSERT INTO movimentacoes_estoque(produto_id,aplicativo_id,tipo_movimento,quantidade,created_at,origem)
    SELECT id,aplicativo_id,'entrada',200,'2020-01-01','TESTE' FROM produtos;
    INSERT INTO movimentacoes_estoque(produto_id,aplicativo_id,tipo_movimento,quantidade,created_at,origem)
    SELECT p.id,p.aplicativo_id,'saida',1,'2026-10-01','TESTE' FROM produtos p CROSS JOIN generate_series(1,50)n
    WHERE n<=right(p.sku,2)::int; ANALYZE produtos; ANALYZE movimentacoes_estoque;`);
  const sql=montarConsultaDivulgacao(app,eventos,0,referencia);
  const plano=await db.query<{"QUERY PLAN":Array<{Plan:unknown;"Execution Time":number}>}>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql.text}`,sql.values);
  const tempo=plano.rows[0]["QUERY PLAN"][0]["Execution Time"];
  assert.ok(Number.isFinite(tempo));
  const pagina=await consultar();assert.equal(pagina.produtos.length,20);assert.equal(pagina.temMais,true);
  const bytes=Buffer.byteLength(JSON.stringify(pagina));
  assert.ok(bytes<16000);
  console.log(JSON.stringify({cenario:"PGlite sintético",produtos:1000,movimentos:await db.query("SELECT count(*) AS total FROM movimentacoes_estoque"),execucaoMs:tempo,respostaBytes:bytes}));
});
test("PostgreSQL: relação das associações permanece inacessível aos papéis públicos", async () => {
  await produto(1);
  for(const papel of ["anon","authenticated"]) {
    try {
      await db.exec(`SET ROLE ${papel}`);
      await assert.rejects(db.query("SELECT produto_id FROM public.calendario_evento_produtos"),/permission denied/i);
    } finally { await db.exec("RESET ROLE"); }
  }
});
