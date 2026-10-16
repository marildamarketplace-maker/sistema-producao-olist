import assert from "node:assert/strict";
import test from "node:test";
import { estaBloqueado, registrarSenhaInvalida, limparTentativasSenha } from "../src/lib/confirmacao-producao-tentativas";

test("bloqueia após cinco erros e libera ao completar quinze minutos", () => {
  const chave = "teste-expiracao";
  for (let i = 0; i < 4; i++) registrarSenhaInvalida(chave, 1000);
  assert.equal(estaBloqueado(chave, 1000), false);
  registrarSenhaInvalida(chave, 1000);
  assert.equal(estaBloqueado(chave, 900999), true);
  assert.equal(estaBloqueado(chave, 901000), false);
});

test("isola identidades e limpa as tentativas depois de uma senha válida", () => {
  const chave = "teste-identidade";
  for (let i = 0; i < 5; i++) registrarSenhaInvalida(chave, 1000);
  assert.equal(estaBloqueado("outra-identidade", 1000), false);
  limparTentativasSenha(chave);
  assert.equal(estaBloqueado(chave, 1000), false);
});
