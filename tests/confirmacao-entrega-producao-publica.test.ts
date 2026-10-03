import assert from "node:assert/strict";
import test from "node:test";
import {
  criarTokenPublicoConfirmacaoProducao,
  senhaPublicaConfirmacaoValida,
  validarTokenPublicoConfirmacaoProducao,
} from "../src/lib/confirmacao-entrega-producao-publica";
import { normalizarItensConfirmacaoProducao } from "../src/lib/confirmar-producao";

const SEGREDO_TESTE = "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres";
const APLICATIVO_ID = "00000000-0000-0000-0000-000000000001";

test("token público assinado preserva aplicativo e expira em sete dias", () => {
  const anterior = process.env.CONFIRMACAO_PRODUCAO_PUBLIC_SECRET;
  process.env.CONFIRMACAO_PRODUCAO_PUBLIC_SECRET = SEGREDO_TESTE;
  try {
    const criadoEm = new Date("2026-10-03T19:00:00.000Z");
    const token = criarTokenPublicoConfirmacaoProducao({
      aplicativoId: APLICATIVO_ID,
      agora: criadoEm,
    });
    const payload = validarTokenPublicoConfirmacaoProducao(
      token,
      new Date("2026-10-10T18:59:59.000Z"),
    );
    assert.equal(payload.aplicativoId, APLICATIVO_ID);
    assert.throws(
      () => validarTokenPublicoConfirmacaoProducao(
        token,
        new Date("2026-10-10T19:00:00.000Z"),
      ),
      /expirou/,
    );
  } finally {
    restaurarEnv("CONFIRMACAO_PRODUCAO_PUBLIC_SECRET", anterior);
  }
});

test("rejeita token adulterado e segredo fraco", () => {
  const anterior = process.env.CONFIRMACAO_PRODUCAO_PUBLIC_SECRET;
  process.env.CONFIRMACAO_PRODUCAO_PUBLIC_SECRET = SEGREDO_TESTE;
  try {
    const token = criarTokenPublicoConfirmacaoProducao({ aplicativoId: APLICATIVO_ID });
    assert.throws(
      () => validarTokenPublicoConfirmacaoProducao(`${token}x`),
      /inválido/,
    );
    process.env.CONFIRMACAO_PRODUCAO_PUBLIC_SECRET = "curto";
    assert.throws(
      () => criarTokenPublicoConfirmacaoProducao({ aplicativoId: APLICATIVO_ID }),
      /32 caracteres/,
    );
  } finally {
    restaurarEnv("CONFIRMACAO_PRODUCAO_PUBLIC_SECRET", anterior);
  }
});

test("aceita somente as duas senhas autorizadas", () => {
  assert.equal(senhaPublicaConfirmacaoValida("marilda"), true);
  assert.equal(senhaPublicaConfirmacaoValida("marcotulio"), true);
  assert.equal(senhaPublicaConfirmacaoValida("Marilda"), false);
  assert.equal(senhaPublicaConfirmacaoValida("marilda "), false);
  assert.equal(senhaPublicaConfirmacaoValida("senha"), false);
});

test("normaliza itens e rejeita quantidades inseguras ou duplicadas", () => {
  assert.deepEqual(
    normalizarItensConfirmacaoProducao([
      { id: " item-1 ", quantidadeProduzida: "12" },
      { id: "item-2", quantidadeProduzida: 0 },
    ]),
    [
      { id: "item-1", quantidadeProduzida: 12 },
      { id: "item-2", quantidadeProduzida: 0 },
    ],
  );
  assert.throws(
    () => normalizarItensConfirmacaoProducao([
      { id: "item-1", quantidadeProduzida: -1 },
    ]),
    /quantidades inteiras/,
  );
  assert.throws(
    () => normalizarItensConfirmacaoProducao([
      { id: "item-1", quantidadeProduzida: 1 },
      { id: "item-1", quantidadeProduzida: 2 },
    ]),
    /duplicados/,
  );
});

function restaurarEnv(nome: string, valor: string | undefined) {
  if (valor === undefined) delete process.env[nome];
  else process.env[nome] = valor;
}
