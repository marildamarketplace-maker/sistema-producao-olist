import assert from "node:assert/strict";
import test from "node:test";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const matriz = id(1), cliente = id(2), filial = id(3), autor = id(4), operador = id(5), filaId = id(6), previaId = id(7);

test("confirmar produção rejeita prévia antiga e vínculo revogado antes de consultar OAuth/Olist", async t => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "ficticia";
  let consultasIntegracao = 0, origemPresente = false, revisao: number | null = 1;
  const origem = { tipo: "VINCULO", usuarioId: autor, aplicativoSolicitanteId: cliente, matrizId: matriz, aplicativoId: filial, vendedorOlistId: 100, revisao: 1 };
  const selecoes = { clienteId: 10, vendedorId: 100, formaId: 20, planoId: id(8), tipoVenda: "VENDA", tecidos: [{ tecidoId: id(9), id: 30, preco: 2 }], laser: null };
  const tx = {
    $queryRaw: async () => [],
    usuario: {
      findFirst: async ({ where }: { where: { id: string } }) => ({ id: where.id, ativo: true, aplicativoId: where.id === autor ? cliente : matriz }),
      findUnique: async () => ({ id: operador, ativo: true, aplicativoId: matriz, podeGerenciarFilaPedidos: true }),
    },
    aplicativo: { findFirst: async () => ({ id: filial, nome: "Filial" }), findUnique: async () => ({ id: filial, aplicativoPaiId: matriz }) },
    fornecedor: { findFirst: async () => ({ id: id(10) }) },
    usuarioVendedorOlist: { findFirst: async () => revisao === null ? null : ({ vendedorOlistId: 100, revisao, origemAplicativoId: cliente, fornecedorMatrizId: matriz }) },
    pedidoFornecedorQueue: { findFirst: async () => ({ id: filaId, versao: 1, status: "PENDENTE", tipoOrigem: "PRODUCAO", solicitacaoProducaoId: id(11), fornecedorId: id(10), aplicativoSolicitanteId: cliente, aplicativoFornecedorId: matriz, aplicativoFilialId: filial, dadosPedido: {} }) },
    previaFornecedor: { findFirst: async () => ({ id: previaId, selecoes: { ...selecoes, ...(origemPresente ? { vendedorOrigem: origem } : {}) }, payload: {} }) },
    integracaoOlistToken: { findUnique: async () => { consultasIntegracao++; throw new Error("Não deveria consultar a integração."); } },
  };
  Object.assign(globalThis, { prisma: { ...tx, $transaction: async <T,>(fn: (db: typeof tx) => Promise<T>) => fn(tx) } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: operador, email: "operador@example.test" } }, error: null }));
  const { POST } = await import("../src/app/api/fornecedores/fila/[id]/olist/route");
  const confirmar = () => POST(new Request("https://example.test", { method: "POST", headers: { Authorization: "Bearer fake" }, body: JSON.stringify({ acao: "confirmar", previaId }) }), { params: Promise.resolve({ id: filaId }) });
  assert.equal((await confirmar()).status, 409, "prévia sem proveniência exige revisão");
  origemPresente = true; revisao = 2;
  assert.equal((await confirmar()).status, 409, "reconfirmar o mesmo ID não valida revisão antiga");
  revisao = null;
  assert.equal((await confirmar()).status, 409, "revogado não pode confirmar");
  assert.equal(consultasIntegracao, 0);
});
