import assert from "node:assert/strict";
import test from "node:test";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

test("referências ocultam contas sem fornecedor e bloqueiam apenas contas sem vendedor vigente", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL="https://example.test"; process.env.SUPABASE_SERVICE_ROLE_KEY="fake";
  let temFornecedor = true, consultasVinculo = 0;
  const vinculos = [{ aplicativoId:id(4), vendedorOlistId:20, fornecedorMatrizId:id(2), aplicativo:{id:id(4),aplicativoPaiId:id(2)} }];
  const db = {
    aplicativo: { findMany: async ({ where }: { where: { OR?: unknown } }) => where.OR ? [{id:id(1),nome:"Próprio"}] : [
      {id:id(3),nome:"Filial A",aplicativoPaiId:id(2)}, {id:id(4),nome:"Filial B",aplicativoPaiId:id(2)},
    ] },
    fornecedor: { findMany: async () => temFornecedor ? [{id:id(6),aplicativoPai:{id:id(2),nome:"Fornecedor"}}] : [] },
    usuarioVendedorOlist: { findMany: async ({ where, select, take }: { where:Record<string,unknown>;select:Record<string,unknown>;take:number }) => {
      consultasVinculo++;
      assert.equal(where.usuarioId,id(5)); assert.equal(where.origemAplicativoId,id(1)); assert.equal(where.revogadoEm,null);
      assert.deepEqual(where.confirmadoEm,{not:null}); assert.equal(take,1001); assert.equal(select.vendedorOlistId,true);
      return vinculos;
    } },
  };
  Object.assign(globalThis,{prisma:{...db,$transaction:async <T,>(fn:(tx:typeof db)=>Promise<T>)=>fn(db)}});
  const {listarReferenciasProducao}=await import("../src/lib/pedido-producao-disponibilidade");
  const usuario={id:id(5),aplicativoId:id(1),podeSelecionarFilialFornecedor:true};
  const opcoes=await listarReferenciasProducao(usuario);
  assert.equal(opcoes.length,2); assert.ok(opcoes.every(o=>o.fornecedorId===id(6)));
  assert.match(opcoes[0].bloqueio!,/vincular.*vendedor/); assert.equal(opcoes[0].vendedorId,null);
  assert.equal(opcoes[1].bloqueio,null); assert.equal(opcoes[1].vendedorId,20); assert.equal(consultasVinculo,1);
  assert.deepEqual(await listarReferenciasProducao({...usuario,podeSelecionarFilialFornecedor:false}),[opcoes[1]],"canônica privilegia uma conta elegível");
  vinculos.length=0;
  const bloqueadas=await listarReferenciasProducao({...usuario,podeSelecionarFilialFornecedor:false});
  assert.equal(bloqueadas.length,1); assert.ok(bloqueadas[0].bloqueio);
  temFornecedor=false;
  const antes=consultasVinculo;
  assert.deepEqual(await listarReferenciasProducao(usuario),[]); assert.equal(consultasVinculo,antes);
});
