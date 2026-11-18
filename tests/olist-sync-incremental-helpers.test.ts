import test from "node:test";
import assert from "node:assert/strict";
import { assinaturaEscopoSync, formatarDesdeIncremental, fusoIncrementalValido, lerPlanoColeta,
  SOBREPOSICAO_INCREMENTAL_MS, type PlanoColetaSync } from "../src/lib/olist-sync/incremental";

function plano(): PlanoColetaSync {
  return { modo: "INCREMENTAL", iniciadaEm: "2026-11-17T05:00:00.000Z", watermarkAnterior: "2026-11-16T05:00:00.000Z",
    desdeUtc: "2026-11-15T05:00:00.000Z", desde: "2026-11-15 02:00:00", geracao: 3, assinaturaEscopo: "assinatura",
    contaIdentidade: "hash-da-conta", fuso: "America/Sao_Paulo", versaoContrato: 1 };
}

test("assinatura independe da ordem dos participantes e muda quando o conjunto ou entidade muda", () => {
  const atual = assinaturaEscopoSync("PRODUTO", ["filho-a", "filho-b"]);
  assert.equal(assinaturaEscopoSync("PRODUTO", ["filho-b", "filho-a"]), atual);
  assert.notEqual(assinaturaEscopoSync("PRODUTO", ["filho-a", "filho-b", "filho-c"]), atual);
  assert.notEqual(assinaturaEscopoSync("CONTATO", ["filho-a", "filho-b"]), atual);
});

test("filtro remoto usa o fuso validado da API inclusive ao cruzar a data", () => {
  const instante = new Date("2026-11-17T01:30:09Z");
  assert.equal(formatarDesdeIncremental(instante, "America/Sao_Paulo"), "2026-11-16 22:30:09");
  assert.equal(formatarDesdeIncremental(instante, "UTC"), "2026-11-17 01:30:09");
});

test("sobreposição representa 24 horas reais mesmo numa mudança de horário de verão", () => {
  const anterior = new Date("2026-03-08T07:30:00Z");
  const desde = new Date(anterior.getTime() - SOBREPOSICAO_INCREMENTAL_MS);
  assert.equal(formatarDesdeIncremental(anterior, "America/New_York"), "2026-03-08 03:30:00");
  assert.equal(formatarDesdeIncremental(desde, "America/New_York"), "2026-03-07 02:30:00");
});

test("fuso ou data inválidos não geram um parâmetro remoto", () => {
  assert.equal(fusoIncrementalValido("America/Conta-Inexistente"), false);
  assert.throws(() => formatarDesdeIncremental(new Date("inválida"), "UTC"));
  assert.throws(() => formatarDesdeIncremental(new Date(), "America/Conta-Inexistente"));
});

test("checkpoint incremental válido mantém exatamente a janela original", () => {
  const congelado = plano();
  assert.deepEqual(lerPlanoColeta(JSON.parse(JSON.stringify(congelado))), congelado);
});

test("checkpoint incompleto ou de versão desconhecida exige nova seleção de coleta", () => {
  assert.equal(lerPlanoColeta({}), null);
  assert.equal(lerPlanoColeta({ ...plano(), contaIdentidade: "" }), null);
  assert.equal(lerPlanoColeta({ ...plano(), versaoContrato: 2 }), null);
  assert.equal(lerPlanoColeta({ ...plano(), geracao: -1 }), null);
});

test("checkpoint não pode avançar o início além do watermark nem reduzir a sobreposição", () => {
  assert.equal(lerPlanoColeta({ ...plano(), iniciadaEm: "2026-11-15T05:00:00.000Z" }), null);
  assert.equal(lerPlanoColeta({ ...plano(), desdeUtc: "2026-11-15T06:00:00.000Z" }), null);
  assert.equal(lerPlanoColeta({ ...plano(), desde: "2026-11-16 02:00:00" }), null);
});

test("coleta completa não aceita filtro incremental embutido", () => {
  assert.equal(lerPlanoColeta({ ...plano(), modo: "COMPLETA" }), null);
  const completa: PlanoColetaSync = { ...plano(), modo: "COMPLETA", desde: null, desdeUtc: null, fuso: null };
  assert.deepEqual(lerPlanoColeta(completa), completa);
});
