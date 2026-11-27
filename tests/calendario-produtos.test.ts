import assert from "node:assert/strict";
import test from "node:test";
import { alteracoesProdutosSchema, aplicarAlteracoesProdutos, autorizarProdutosCalendario, buscaProdutosSchema, ProdutoCalendarioIndisponivel } from "../src/lib/calendario-comercial/produtos";

const id = "00000000-0000-4000-8000-000000000001";
const outro = "00000000-0000-4000-8000-000000000002";
test("autoriza somente usuário ativo com aplicativo e permissão", () => {
  const usuario = { ativo: true, aplicativoId: id, podeVisualizarTarefasMidia: true };
  assert.equal(autorizarProdutosCalendario(usuario), id);
  for (const invalido of [null, { ...usuario, ativo: false }, { ...usuario, aplicativoId: null }, { ...usuario, podeVisualizarTarefasMidia: false }]) {
    assert.throws(() => autorizarProdutosCalendario(invalido), /Sem permissão/);
  }
});
test("valida evento, termo e paginação e mantém ativos como padrão", () => {
  assert.deepEqual(buscaProdutosSchema.parse({ eventoId: "natal" }), { eventoId: "natal", busca: "", associados: false, pagina: 0 });
  for (const entrada of [{ eventoId: "inexistente" }, { eventoId: "natal", pagina: -1 }, { eventoId: "natal", pagina: 1.5 }, { eventoId: "natal", busca: "a".repeat(121) }]) {
    assert.equal(buscaProdutosSchema.safeParse(entrada).success, false);
  }
});
test("recusa duplicação, sobreposição, IDs inválidos e lotes excessivos", () => {
  for (const entrada of [
    { adicionar: [id, id], remover: [] }, { adicionar: [id], remover: [id] },
    { adicionar: ["inválido"], remover: [] }, { adicionar: Array(101).fill(id), remover: [] },
  ]) assert.equal(alteracoesProdutosSchema.safeParse({ eventoId: "natal", ...entrada }).success, false);
});
test("não altera nenhum vínculo quando uma inclusão está indisponível ou é de outro aplicativo", async () => {
  let mutacoes = 0;
  await assert.rejects(aplicarAlteracoesProdutos({ eventoId: "natal", adicionar: [id, outro], remover: [outro] }, {
    bloquearProdutosAtivos: async () => [id],
    adicionar: async () => { mutacoes++; }, remover: async () => { mutacoes++; },
  }), ProdutoCalendarioIndisponivel);
  assert.equal(mutacoes, 0);
});
test("aplica somente o delta e permite remover produto que ficou inativo", async () => {
  const chamadas: unknown[] = [];
  await aplicarAlteracoesProdutos({ eventoId: "natal", adicionar: [outro, id], remover: [] }, {
    bloquearProdutosAtivos: async (ids) => { chamadas.push(["lock", ids]); return ids; },
    adicionar: async (ids) => { chamadas.push(["add", ids]); }, remover: async () => assert.fail("Não deve remover vínculos de outra sessão"),
  });
  assert.deepEqual(chamadas, [["lock", [id, outro]], ["add", [id, outro]]]);
  await aplicarAlteracoesProdutos({ eventoId: "natal", adicionar: [], remover: [id] }, {
    bloquearProdutosAtivos: async () => assert.fail("Remoção não depende do estado ativo"),
    adicionar: async () => assert.fail(), remover: async (ids) => assert.deepEqual(ids, [id]),
  });
});
