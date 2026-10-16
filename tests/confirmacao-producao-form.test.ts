import assert from "node:assert/strict";
import test from "node:test";
import { lerFormularioConfirmacao } from "../src/lib/confirmacao-producao-form";
import { MAX_CORPO_CONFIRMACAO_BYTES, MAX_FOTO_EVIDENCIA_BYTES } from "../src/lib/producao-evidencia-contrato";

function requisicao(foto?: File, itens = "[]") {
  const form = new FormData();
  form.set("solicitacaoId", " pedido "); form.set("senha", "senha-teste"); form.set("itens", itens);
  if (foto) form.set("foto", foto);
  return new Request("https://example.test", { method: "POST", body: form });
}

test("lê multipart com foto, senha e itens sem aceitar URL como evidência", async () => {
  const dados = await lerFormularioConfirmacao(requisicao(new File(["foto"], "foto.jpg"), '[{"id":"item"}]'));
  assert.equal(dados.solicitacaoId, "pedido"); assert.equal(dados.senha, "senha-teste");
  assert.deepEqual(dados.itens, [{ id: "item" }]); assert.equal(dados.foto.size, 4);
  await assert.rejects(lerFormularioConfirmacao(requisicao()), /foto/);
  await assert.rejects(lerFormularioConfirmacao(new Request("https://example.test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ evidenciaUrl: "https://example.test/foto.jpg" }) })), /foto/);
});

test("recusa arquivo acima de 3 MB e itens inválidos", async () => {
  await assert.rejects(lerFormularioConfirmacao(requisicao(new File([new Uint8Array(MAX_FOTO_EVIDENCIA_BYTES + 1)], "grande.jpg"))), /3 MB/);
  await assert.rejects(lerFormularioConfirmacao(requisicao(new File(["foto"], "foto.jpg"), "invalido")), /itens/);
});

test("impõe limite total mesmo sem Content-Length ou com valor declarado menor", async () => {
  const cenarios: HeadersInit[] = [{ "Content-Type": "multipart/form-data; boundary=teste" }, { "Content-Type": "multipart/form-data; boundary=teste", "Content-Length": "10" }];
  for (const headers of cenarios) {
    const request = new Request("https://example.test", { method: "POST", headers, body: new Uint8Array(MAX_CORPO_CONFIRMACAO_BYTES + 1) });
    await assert.rejects(lerFormularioConfirmacao(request), /limite permitido/);
  }
});
