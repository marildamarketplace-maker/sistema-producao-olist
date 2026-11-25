import assert from "node:assert/strict";
import test from "node:test";
import { consultarPaginaCatalogoTecidosOlist, PRAZO_PAGINA_CATALOGO_TECIDOS_MS } from "../src/lib/consulta-catalogo-tecidos-olist";

test("consulta concluída devolve o resultado e preserva erros recuperáveis", async () => {
  const signal = new AbortController().signal;
  assert.deepEqual(await consultarPaginaCatalogoTecidosOlist(async () => ({ itens: [] }), signal, 50), { itens: [] });
  await assert.rejects(consultarPaginaCatalogoTecidosOlist(async () => { throw new Error("Olist indisponível"); }, signal, 50), /Olist indisponível/);
});

test("prazo encerra transporte e consulta mesmo se o provedor ignorar abort", async () => {
  let signalPagina: AbortSignal | undefined;
  let responder: ((valor: unknown) => void) | undefined;
  const consulta = consultarPaginaCatalogoTecidosOlist(async signal => {
    signalPagina = signal;
    return new Promise(resolve => { responder = resolve; });
  }, new AbortController().signal, 10);
  await assert.rejects(consulta, /demorou/);
  assert.equal(signalPagina?.aborted, true);
  responder?.({ itens: ["Resposta atrasada"] });
  await assert.rejects(consulta, /demorou/, "Resultado tardio não reabre a consulta encerrada");
});

test("cancelamento anterior ou durante consulta impede aceitar resposta tardia", async () => {
  const antes = new AbortController(); antes.abort();
  await assert.rejects(async () => consultarPaginaCatalogoTecidosOlist(async () => assert.fail("Não deve consultar"), antes.signal), { name: "AbortError" });
  const durante = new AbortController();
  let signalPagina: AbortSignal | undefined;
  const consulta = consultarPaginaCatalogoTecidosOlist(async signal => { signalPagina = signal; return new Promise(() => {}); }, durante.signal, 100);
  durante.abort();
  await assert.rejects(consulta, { name: "AbortError" });
  assert.equal(signalPagina?.aborted, true);
});

test("prazo inválido não dispara requisição e o limite padrão é de 30 segundos", async () => {
  assert.equal(PRAZO_PAGINA_CATALOGO_TECIDOS_MS, 30_000);
  for (const prazo of [0, 1.5, 30_001, NaN]) await assert.rejects(consultarPaginaCatalogoTecidosOlist(async () => assert.fail("Não deve consultar"), new AbortController().signal, prazo), /Prazo/);
});
