import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { criarPostgresMemoria } from "./helpers/postgres-memoria";
import { prepararBancoVendedores,cadastrarFornecedorTeste,confirmarVendedorTeste,
  idsVendedores as i,idVendedorTeste as id } from "./helpers/vendedores-fornecedores-banco";

test("vendedores externos: vigência, duplicados, revogação e reconfirmação sem reativação implícita", async () => {
  const db=criarPostgresMemoria();
  try {
    await prepararBancoVendedores(db);
    await assert.rejects(confirmarVendedorTeste(db),/relação ativa/);
    await cadastrarFornecedorTeste(db);
    await cadastrarFornecedorTeste(db,i.duplicado);
    await cadastrarFornecedorTeste(db,i.outroFornecedor,i.outraMatriz);
    await confirmarVendedorTeste(db);
    await confirmarVendedorTeste(db,i.matriz,i.matriz,210);
    await confirmarVendedorTeste(db,i.outraMatriz,i.outraMatriz,300);
    const vinculos=()=>db.query<{aplicativo_id:string;vendedor_olist_id:number;revisao:number;revogado_em:Date|null}>(
      "SELECT aplicativo_id,vendedor_olist_id,revisao,revogado_em FROM usuario_vendedor_olist WHERE usuario_id=$1 ORDER BY aplicativo_id",[i.usuario]);
    const antes=(await vinculos()).rows;
    await db.query("UPDATE fornecedores SET ativo=false WHERE id=$1",[i.fornecedor]);
    assert.equal((await vinculos()).rows.find(v=>v.aplicativo_id===i.filial)?.revogado_em,null);
    await db.query("DELETE FROM fornecedores WHERE id=$1",[i.duplicado]);
    const revogados=(await vinculos()).rows;
    assert.ok(revogados.find(v=>v.aplicativo_id===i.filial)?.revogado_em);
    assert.ok(revogados.find(v=>v.aplicativo_id===i.matriz)?.revogado_em);
    assert.equal(revogados.find(v=>v.aplicativo_id===i.outraMatriz)?.revogado_em,null);
    assert.equal(revogados.find(v=>v.aplicativo_id===i.cliente)?.revogado_em,null,"não revoga vínculo interno");
    assert.ok(revogados.find(v=>v.aplicativo_id===i.filial)!.revisao>antes.find(v=>v.aplicativo_id===i.filial)!.revisao);
    await cadastrarFornecedorTeste(db,id(23));
    assert.ok((await vinculos()).rows.find(v=>v.aplicativo_id===i.filial)?.revogado_em,"recadastro não reativa");
    await confirmarVendedorTeste(db,i.filial,i.matriz,201);
    const reconfirmado=(await vinculos()).rows.find(v=>v.aplicativo_id===i.filial)!;
    assert.equal(reconfirmado.revogado_em,null);
    assert.equal(reconfirmado.vendedor_olist_id,201);
    assert.ok(reconfirmado.revisao>revogados.find(v=>v.aplicativo_id===i.filial)!.revisao,"prévia antiga não recupera revisão");
    await assert.rejects(db.query("UPDATE usuario_vendedor_olist SET origem_aplicativo_id=$1 WHERE usuario_id=$2 AND aplicativo_id=$3",[i.outroCliente,i.usuario,i.filial]),/relação ativa/);
    await assert.rejects(confirmarVendedorTeste(db,i.neto,i.matriz),/relação ativa/);
    for(const role of ["anon","authenticated"]) {
      for(const privilege of ["INSERT","UPDATE","DELETE"]) {
        const r=await db.query<{permitido:boolean}>("SELECT has_table_privilege($1,'fornecedores',$2) AS permitido",[role,privilege]);
        assert.equal(r.rows[0].permitido,false);
      }
      assert.equal((await db.query<{permitido:boolean}>("SELECT has_table_privilege($1,'usuario_vendedor_olist','SELECT') AS permitido",[role])).rows[0].permitido,false);
      assert.equal((await db.query<{permitido:boolean}>("SELECT has_column_privilege($1,'fornecedores','aplicativo_id','UPDATE') AS permitido",[role])).rows[0].permitido,false);
      assert.equal((await db.query<{permitido:boolean}>("SELECT has_column_privilege($1,'fornecedores','aplicativo_pai_id','INSERT') AS permitido",[role])).rows[0].permitido,false);
    }
  } finally { await db.close(); }
});

test("vínculo externo ativo não atravessa transferência do usuário ou reparentamento",async()=>{
  const db=criarPostgresMemoria();
  try {
    await prepararBancoVendedores(db); await cadastrarFornecedorTeste(db); await confirmarVendedorTeste(db);
    await assert.rejects(db.query("UPDATE aplicativo SET aplicativo_pai_id=$1 WHERE id=$2",[i.outraMatriz,i.filial]),/vínculos incompatíveis/);
    await db.query("DELETE FROM usuario_vendedor_olist WHERE usuario_id=$1 AND aplicativo_id=$2",[i.usuario,i.cliente]);
    await db.query("UPDATE usuario SET vendedor_olist_id=NULL WHERE id=$1",[i.usuario]);
    await assert.rejects(db.query("UPDATE usuario SET aplicativo_id=$1 WHERE id=$2",[i.outroCliente,i.usuario]),/vínculos incompatíveis/);
    await db.query("UPDATE fornecedores SET ativo=false WHERE id=$1",[i.fornecedor]);
    await db.query("UPDATE usuario SET aplicativo_id=$1 WHERE id=$2",[i.outroCliente,i.usuario]);
    await db.query("UPDATE aplicativo SET aplicativo_pai_id=$1 WHERE id=$2",[i.outraMatriz,i.filial]);
    await assert.rejects(db.query("UPDATE usuario_vendedor_olist SET revogado_em=NULL WHERE usuario_id=$1 AND aplicativo_id=$2",[i.usuario,i.filial]),/relação ativa/);
  } finally {await db.close();}
});

test("manual externo preserva autoria e histórico, sem virar produção ou mover origem",async()=>{
  const db=criarPostgresMemoria();
  try {
    await prepararBancoVendedores(db);await cadastrarFornecedorTeste(db);await confirmarVendedorTeste(db);
    const inserir=(fila:string,cliente=i.cliente,matriz=i.matriz,autor=i.usuario,fornecedor:string|null=i.fornecedor)=>db.query(`
      INSERT INTO pedido_fornecedor_queue(id,tipo_origem,fornecedor_id,autor_id,chave_idempotencia,hash_entrada,
        aplicativo_solicitante_id,aplicativo_fornecedor_id) VALUES($1,'MANUAL',$2,$3,$4,'hash',$5,$6)`,
      [fila,fornecedor,autor,id(99),cliente,matriz]);
    await inserir(id(30));
    await inserir(id(31),i.cliente,i.cliente,i.usuario,null);
    await assert.rejects(inserir(id(32),i.outroCliente),/Fornecedor não corresponde/);
    await assert.rejects(inserir(id(33),i.cliente,i.matriz,i.outroUsuario),/não está autorizada/);
    await assert.rejects(inserir(id(34),i.cliente,i.cliente),/ck_fila_origem|Fornecedor não corresponde/);
    await assert.rejects(db.query("DELETE FROM fornecedores WHERE id=$1",[i.fornecedor]),/foreign key/);
    await assert.rejects(db.query("UPDATE fornecedores SET aplicativo_pai_id=$1 WHERE id=$2",[i.outraMatriz,i.fornecedor]),/histórico/);
    await db.query("UPDATE fornecedores SET ativo=false WHERE id=$1",[i.fornecedor]);
    await assert.rejects(inserir(id(35)),/não está autorizada/);
    await db.query("UPDATE pedido_fornecedor_queue SET status='CONCLUIDO' WHERE id=$1",[id(30)]);
    await assert.rejects(db.query("UPDATE pedido_fornecedor_queue SET fornecedor_id=NULL,aplicativo_fornecedor_id=aplicativo_solicitante_id WHERE id=$1",[id(30)]),/origem.*não pode/);
    assert.equal((await db.query("SELECT count(*)::int AS total FROM pedido_fornecedor_queue")).rows[0].total,2);
  }finally {await db.close();}
});

test("salvamento externo preserva outros grupos e revisão de empresas inalteradas",async()=>{
  const db=criarPostgresMemoria();
  try {
    await prepararBancoVendedores(db);await cadastrarFornecedorTeste(db);
    await cadastrarFornecedorTeste(db,i.outroFornecedor,i.outraMatriz);
    await confirmarVendedorTeste(db,i.outraMatriz,i.outraMatriz,300);
    const sql=(consulta:Prisma.Sql|TemplateStringsArray,valores:unknown[])=>"text" in consulta?consulta:Prisma.sql(consulta,...valores);
    const tx={
      $queryRaw:async(consulta:Prisma.Sql|TemplateStringsArray,...valores:unknown[])=>{
        const q=sql(consulta,valores);return(await db.query(q.text,q.values)).rows;
      },
      $executeRaw:async(consulta:TemplateStringsArray,...valores:unknown[])=>{
        const q=sql(consulta,valores);await db.query(q.text,q.values);return 1;
      },
      usuario:{findUniqueOrThrow:async({where}:{where:{id:string}})=>(await db.query(
        'SELECT vinculos_olist_versao AS "vinculosOlistVersao" FROM usuario WHERE id=$1',[where.id])).rows[0]},
      fornecedor:{findFirst:async({where}:{where:{aplicativoId:string;aplicativoPaiId:string;ativo:boolean}})=>{
        assert.equal(where.ativo,true);
        return(await db.query("SELECT id FROM fornecedores WHERE aplicativo_id=$1 AND aplicativo_pai_id=$2 AND ativo LIMIT 1",
          [where.aplicativoId,where.aplicativoPaiId])).rows[0]??null;
      }},
      usuarioVendedorOlist:{updateMany:async({where,data}:{where:{usuarioId:string;origemAplicativoId:string;fornecedorMatrizId:string;
        revogadoEm:null;aplicativoId:{notIn:string[]}};data:{revogadoEm:Date;motivoRevogacao:string}})=>{
        assert.equal(where.revogadoEm,null);
        await db.query(`UPDATE usuario_vendedor_olist SET revogado_em=$1,motivo_revogacao=$2
          WHERE usuario_id=$3 AND origem_aplicativo_id=$4 AND fornecedor_matriz_id=$5 AND revogado_em IS NULL
            AND NOT(aplicativo_id=ANY($6::uuid[]))`,[data.revogadoEm,data.motivoRevogacao,where.usuarioId,
          where.origemAplicativoId,where.fornecedorMatrizId,where.aplicativoId.notIn]);
        return {count:0};
      }},
    };
    Object.assign(globalThis,{prisma:tx});
    const {substituirVendedoresExternosOlist}=await import("../src/lib/usuario-vendedor-olist");
    const versao=async()=>Number((await db.query("SELECT vinculos_olist_versao AS v FROM usuario WHERE id=$1",[i.usuario])).rows[0].v);
    const salvar=async(entradas:Array<{aplicativoId:string;vendedorOlistId:number}>,esperada:number)=>{
      await db.exec("BEGIN");
      try {
        const v=await substituirVendedoresExternosOlist(tx as unknown as Prisma.TransactionClient,
          i.usuario,i.cliente,i.matriz,entradas,esperada,i.operador);
        await db.exec("COMMIT");return v;
      }catch(e){await db.exec("ROLLBACK");throw e;}
    };
    const ler=async()=>(await db.query<{aplicativo_id:string;vendedor_olist_id:number;revisao:number;revogado_em:Date|null}>(
      "SELECT aplicativo_id,vendedor_olist_id,revisao,revogado_em FROM usuario_vendedor_olist WHERE usuario_id=$1 ORDER BY aplicativo_id",[i.usuario])).rows;
    const entradas=[{aplicativoId:i.matriz,vendedorOlistId:200},{aplicativoId:i.filial,vendedorOlistId:201}];
    const v=await salvar(entradas,await versao());
    const antes=await ler();
    assert.equal(await salvar(entradas,v),v,"salvar sem alterações não invalida prévias");
    assert.deepEqual(await ler(),antes);
    await salvar([{...entradas[0]},{...entradas[1],vendedorOlistId:202}],await versao());
    const depois=await ler();
    assert.equal(depois.find(x=>x.aplicativo_id===i.matriz)?.revisao,antes.find(x=>x.aplicativo_id===i.matriz)?.revisao);
    assert.ok(depois.find(x=>x.aplicativo_id===i.filial)!.revisao>antes.find(x=>x.aplicativo_id===i.filial)!.revisao);
    await assert.rejects(salvar([{aplicativoId:i.outraMatriz,vendedorOlistId:999}],await versao()),/matriz fornecedora/);
    assert.deepEqual(await ler(),depois,"destino inválido não causa remoções parciais");
    await salvar([],await versao());
    const revogados=await ler();
    assert.ok(revogados.find(x=>x.aplicativo_id===i.matriz)?.revogado_em);
    assert.ok(revogados.find(x=>x.aplicativo_id===i.filial)?.revogado_em);
    assert.deepEqual(revogados.filter(x=>[i.cliente,i.outraMatriz].includes(x.aplicativo_id)),antes.filter(x=>[i.cliente,i.outraMatriz].includes(x.aplicativo_id)));
    await assert.rejects(salvar(entradas,0),/vínculos foram alterados/i);

    // Uma filial cliente continua podendo vender para a matriz/irmãs, mas sua
    // própria conta é gerida pelo cadastro nativo, nunca pelo fornecedor.
    await db.query("UPDATE aplicativo SET aplicativo_pai_id=$1 WHERE id=$2",[i.matriz,i.cliente]);
    const nativo=(await ler()).find(x=>x.aplicativo_id===i.cliente)!;
    await assert.rejects(salvar([{aplicativoId:i.cliente,vendedorOlistId:999}],await versao()),/vínculos internos/);
    assert.deepEqual((await ler()).find(x=>x.aplicativo_id===i.cliente),nativo);
    await salvar(entradas,await versao());
    await db.query("UPDATE fornecedores SET ativo=false WHERE id=$1",[i.fornecedor]);
    const encerrados=await ler();
    assert.deepEqual(encerrados.find(x=>x.aplicativo_id===i.cliente),nativo,"encerramento preserva o vendedor nativo da filial cliente");
    assert.ok(encerrados.find(x=>x.aplicativo_id===i.matriz)?.revogado_em);
    assert.ok(encerrados.find(x=>x.aplicativo_id===i.filial)?.revogado_em);
  }finally {await db.close();}
});

test("banco impede converter vínculo nativo ou ocupar conta nativa como vendedor externo",async()=>{
  const db=criarPostgresMemoria();
  try {
    await prepararBancoVendedores(db);
    await db.query("UPDATE aplicativo SET aplicativo_pai_id=$1 WHERE id=$2",[i.matriz,i.cliente]);
    await cadastrarFornecedorTeste(db);
    const nativo=async()=>(await db.query("SELECT vendedor_olist_id,origem_aplicativo_id,fornecedor_matriz_id,revisao FROM usuario_vendedor_olist WHERE usuario_id=$1 AND aplicativo_id=$2",[i.usuario,i.cliente])).rows;
    const antes=await nativo();
    await assert.rejects(db.query(`INSERT INTO usuario_vendedor_olist(usuario_id,aplicativo_id,vendedor_olist_id,
        origem_aplicativo_id,fornecedor_matriz_id,confirmado_em,confirmado_por_id)
      VALUES($1,$2,999,$2,$3,clock_timestamp(),$4)
      ON CONFLICT(usuario_id,aplicativo_id) DO UPDATE SET vendedor_olist_id=EXCLUDED.vendedor_olist_id,
        origem_aplicativo_id=EXCLUDED.origem_aplicativo_id,fornecedor_matriz_id=EXCLUDED.fornecedor_matriz_id,
        confirmado_em=EXCLUDED.confirmado_em,confirmado_por_id=EXCLUDED.confirmado_por_id`,
      [i.usuario,i.cliente,i.matriz,i.operador]),/vínculos internos|reinterpretado como externo/);
    assert.deepEqual(await nativo(),antes);
    await db.query("DELETE FROM usuario_vendedor_olist WHERE usuario_id=$1 AND aplicativo_id=$2",[i.usuario,i.cliente]);
    await assert.rejects(confirmarVendedorTeste(db,i.cliente,i.matriz,999),/vínculos internos/,
      "a ausência de vendedor não transfere a gestão da conta nativa ao fornecedor");
    await db.query("INSERT INTO usuario_vendedor_olist(usuario_id,aplicativo_id,vendedor_olist_id) VALUES($1,$2,100)",[i.usuario,i.cliente]);
    await confirmarVendedorTeste(db,i.matriz,i.matriz,200);
    await confirmarVendedorTeste(db,i.filial,i.matriz,201);
    await db.query("UPDATE fornecedores SET ativo=false WHERE id=$1",[i.fornecedor]);
    assert.equal((await nativo())[0].vendedor_olist_id,100);
    assert.equal((await nativo())[0].origem_aplicativo_id,null);
  }finally {await db.close();}
});

test("revisão não é reutilizada após delete/recriação nativa, lotes e restauração do mesmo vendedor",async()=>{
  const db=criarPostgresMemoria();
  const compatibilidadeAnterior=process.env.OLIST_VENDEDORES_COMPAT_LEGADO;
  try {
    await prepararBancoVendedores(db);
    await cadastrarFornecedorTeste(db,i.fornecedor,i.cliente);
    await db.query("INSERT INTO aplicativo(id,nome,aplicativo_pai_id) VALUES($1,'Filho A',$3),($2,'Filho B',$3)",[id(7),id(8),i.cliente]);
    const ler=async()=>(await db.query<{aplicativo_id:string;vendedor_olist_id:number;revisao:number}>(
      "SELECT aplicativo_id,vendedor_olist_id,revisao FROM usuario_vendedor_olist WHERE usuario_id=$1 ORDER BY aplicativo_id",[i.usuario])).rows;
    const original=(await ler())[0];
    assert.equal(original.revisao,1);
    assert.equal((await db.query("SELECT vinculos_olist_versao AS v FROM usuario WHERE id=$1",[i.usuario])).rows[0].v,0,
      "cobre a revisão inicial legada, anterior ao contador");
    const sql=(consulta:Prisma.Sql|TemplateStringsArray,valores:unknown[])=>"text" in consulta?consulta:Prisma.sql(consulta,...valores);
    const client={
      $queryRaw:async(consulta:Prisma.Sql|TemplateStringsArray,...valores:unknown[])=>{
        const q=sql(consulta,valores);return(await db.query(q.text,q.values)).rows;
      },
      $executeRaw:async(consulta:TemplateStringsArray,...valores:unknown[])=>{
        const q=sql(consulta,valores);await db.query(q.text,q.values);return 1;
      },
      aplicativo:{findUnique:async()=>({id:i.cliente,aplicativoPaiId:null})},
      fornecedor:{findFirst:async()=>({id:i.fornecedor})},
      usuario:{findFirst:async()=>({id:i.usuario}),findUniqueOrThrow:async()=>(await db.query(
        'SELECT vinculos_olist_versao AS "vinculosOlistVersao" FROM usuario WHERE id=$1',[i.usuario])).rows[0]},
      usuarioVendedorOlist:{
        findFirst:async()=>(await db.query(`SELECT vendedor_olist_id AS "vendedorOlistId",revisao,
          origem_aplicativo_id AS "origemAplicativoId",fornecedor_matriz_id AS "fornecedorMatrizId"
          FROM usuario_vendedor_olist WHERE usuario_id=$1 AND aplicativo_id=$2`,[i.usuario,i.cliente])).rows[0],
        deleteMany:async({where}:{where:{usuarioId:string;origemAplicativoId:null;fornecedorMatrizId:null;
          aplicativoId:string|{not:string;notIn:string[]};aplicativo?:{aplicativoPaiId:string}}})=>{
          assert.equal(where.origemAplicativoId,null);assert.equal(where.fornecedorMatrizId,null);
          if(typeof where.aplicativoId==="string") await db.query(`DELETE FROM usuario_vendedor_olist
            WHERE usuario_id=$1 AND aplicativo_id=$2 AND origem_aplicativo_id IS NULL AND fornecedor_matriz_id IS NULL`,
            [where.usuarioId,where.aplicativoId]);
          else await db.query(`DELETE FROM usuario_vendedor_olist WHERE usuario_id=$1 AND aplicativo_id<>$2
            AND NOT(aplicativo_id=ANY($3::uuid[])) AND origem_aplicativo_id IS NULL AND fornecedor_matriz_id IS NULL
            AND aplicativo_id IN(SELECT id FROM aplicativo WHERE aplicativo_pai_id=$4)`,
            [where.usuarioId,where.aplicativoId.not,where.aplicativoId.notIn,where.aplicativo?.aplicativoPaiId]);
          return {count:0};
        },
        upsert:async({create}:{create:{usuarioId:string;aplicativoId:string;vendedorOlistId:number}})=>{
          await db.query(`INSERT INTO usuario_vendedor_olist(usuario_id,aplicativo_id,vendedor_olist_id) VALUES($1,$2,$3)
            ON CONFLICT(usuario_id,aplicativo_id) DO UPDATE SET vendedor_olist_id=EXCLUDED.vendedor_olist_id,
              origem_aplicativo_id=NULL,fornecedor_matriz_id=NULL,confirmado_em=NULL,confirmado_por_id=NULL,
              revogado_em=NULL,motivo_revogacao=NULL`,[create.usuarioId,create.aplicativoId,create.vendedorOlistId]);
        },
      },
    };
    Object.assign(globalThis,{prisma:client});
    const {substituirVendedoresOlist}=await import("../src/lib/usuario-vendedor-olist");
    const {capturarVendedorFila}=await import("../src/lib/vendedor-fila-producao");
    const tx=client as unknown as Prisma.TransactionClient;
    const entrada={usuarioId:i.usuario,aplicativoSolicitanteId:i.cliente,matrizId:i.cliente,
      aplicativoId:i.cliente,vendedorOlistId:100,fonte:"VINCULO" as const,revisaoEsperada:original.revisao};
    const captura=await capturarVendedorFila(entrada,tx);
    assert.ok("revisao" in captura);
    assert.equal(captura.revisao,original.revisao);
    process.env.OLIST_VENDEDORES_COMPAT_LEGADO="false";
    await db.exec("BEGIN");
    const versaoRemovida=await substituirVendedoresOlist(tx,i.usuario,i.cliente,[],0);
    assert.ok(versaoRemovida>0);
    await assert.rejects(capturarVendedorFila(entrada,tx),/Vínculo do vendedor alterado/);
    const versaoRestaurada=await substituirVendedoresOlist(tx,i.usuario,i.cliente,[{aplicativoId:i.cliente,vendedorOlistId:100}],versaoRemovida);
    assert.ok(versaoRestaurada>versaoRemovida);
    await db.exec("COMMIT");
    assert.ok((await ler())[0].revisao>original.revisao,"mesmo vendedor exige proveniência nova após exclusão");
    await assert.rejects(capturarVendedorFila(entrada,tx),/Vínculo do vendedor alterado/,
      "helper usado pela API nativa não ressuscita a captura antiga ao recriar o mesmo vendedor");

    const lote=[{aplicativoId:i.cliente,vendedorOlistId:100},{aplicativoId:id(7),vendedorOlistId:200},{aplicativoId:id(8),vendedorOlistId:300}];
    const inserir=()=>db.query(`INSERT INTO usuario_vendedor_olist(usuario_id,aplicativo_id,vendedor_olist_id)
      SELECT $1,x."aplicativoId",x."vendedorOlistId" FROM jsonb_to_recordset($2::jsonb)
        AS x("aplicativoId" uuid,"vendedorOlistId" integer) ORDER BY x."aplicativoId"
      ON CONFLICT(usuario_id,aplicativo_id) DO UPDATE SET vendedor_olist_id=EXCLUDED.vendedor_olist_id`,[i.usuario,JSON.stringify(lote)]);
    await inserir();
    const antesLote=await ler();
    await db.exec("BEGIN");
    await db.query("DELETE FROM usuario_vendedor_olist WHERE usuario_id=$1",[i.usuario]);
    await inserir();
    const recriados=await ler();
    for(const row of recriados) assert.ok(row.revisao>antesLote.find(a=>a.aplicativo_id===row.aplicativo_id)!.revisao);
    await db.query("UPDATE usuario_vendedor_olist SET vendedor_olist_id=vendedor_olist_id+1 WHERE usuario_id=$1",[i.usuario]);
    await db.query("UPDATE usuario_vendedor_olist SET vendedor_olist_id=vendedor_olist_id-1 WHERE usuario_id=$1",[i.usuario]);
    await db.exec("COMMIT");
    for(const row of await ler()) {
      const anterior=recriados.find(a=>a.aplicativo_id===row.aplicativo_id)!;
      assert.equal(row.vendedor_olist_id,anterior.vendedor_olist_id);
      assert.ok(row.revisao>anterior.revisao,"restaurar ID em UPDATE de lote não recupera a revisão");
    }

    await assert.rejects(capturarVendedorFila(entrada,tx),
    /Vínculo do vendedor alterado/,"captura/prévia antiga continua inválida após recriar vendedor idêntico");
  }finally {
    if(compatibilidadeAnterior===undefined) delete process.env.OLIST_VENDEDORES_COMPAT_LEGADO;
    else process.env.OLIST_VENDEDORES_COMPAT_LEGADO=compatibilidadeAnterior;
    await db.close();
  }
});
