import assert from "node:assert/strict";
import { test } from "node:test";
import { criarClienteFilaWorker, ErroComunicacaoFila } from "@/lib/automatizacao/cliente-fila-worker";
import { renovarEnquantoValida } from "@/lib/automatizacao/renovacao";

const segredo = "SECRET_TEST";
const destino = new URL(`https://erp.test/api/interno/automatizacao?token=${segredo}`);
function cliente(requisitar: typeof fetch) {
  const logs: string[] = [];
  return { logs, api: criarClienteFilaWorker({ destino, token: segredo, requisitar, registrarFalha: (evento) => logs.push(evento) }) };
}

test("cliente preserva requisição autenticada, timeout e retorno sem registrar sucessos", async () => {
  const corpo = { acao: "reservar" };
  const { api, logs } = cliente(async (url, init) => {
    assert.equal(url, destino);
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${segredo}`);
    assert.equal(init?.body, JSON.stringify(corpo));
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json({ trabalho: null });
  });
  assert.deepEqual(await api(corpo), { trabalho: null });
  assert.deepEqual(logs, []);
});

test("renovação recusada preserva perda de reserva e identifica 401, 403 e 409", async () => {
  for (const status of [401, 403, 409]) {
    let chamadas = 0;
    const { api, logs } = cliente(async () => {
      chamadas++;
      return new Response(segredo, { status, headers: {
        "content-type": "text/html", "x-vercel-id": "cdg1::iad1::teste-123",
        "x-vercel-mitigated": "challenge", "set-cookie": segredo,
      } });
    });
    assert.equal(await api({ acao: "renovar", reserva: segredo }), null);
    assert.equal(chamadas, 1);
    const evento = JSON.parse(logs[0]);
    assert.equal(evento.acao, "renovar");
    assert.equal(evento.statusHttp, status);
    assert.equal(evento.formatoResposta, "HTML");
    assert.equal(evento.desafioVercel, true);
    assert.equal(evento.requisicaoId, "cdg1::iad1::teste-123");
    assert.doesNotMatch(logs.join(""), /SECRET_TEST|erp\.test|set-cookie|Authorization/);
  }
});

test("falhas HTTP de reserva/finalização lançam erro seguro sem repetir chamadas", async () => {
  for (const acao of ["reservar", "finalizar"]) {
    for (const status of [401, 403, 429, 500, 502, 503]) {
      let chamadas = 0;
      const { api, logs } = cliente(async () => {
        chamadas++;
        return new Response(`Erro privado ${segredo}`, { status, headers: { "x-vercel-id": `token=${segredo}` } });
      });
      await assert.rejects(api({ acao, reserva: segredo, resultado: segredo }), ErroComunicacaoFila);
      assert.equal(chamadas, 1);
      assert.equal(logs.length, 1);
      const evento = JSON.parse(logs[0]);
      assert.equal(evento.statusHttp, status);
      assert.equal(evento.requisicaoId, undefined);
      assert.doesNotMatch(logs[0], /SECRET_TEST|Erro privado/);
    }
  }
});

test("JSON inválido registra status e formato sem copiar o corpo", async () => {
  const { api, logs } = cliente(async () => new Response(`<html>${segredo}</html>`, { headers: { "content-type": "text/html" } }));
  await assert.rejects(api({ acao: "reservar" }), ErroComunicacaoFila);
  const evento = JSON.parse(logs[0]);
  assert.equal(evento.motivo, "JSON_INVALIDO");
  assert.equal(evento.statusHttp, 200);
  assert.equal(evento.formatoResposta, "HTML");
  assert.doesNotMatch(logs[0], /SECRET_TEST|<html>/);
});

test("transporte usa códigos permitidos sem copiar exceções e suas causas", async () => {
  for (const [code, motivo] of [
    ["ENOTFOUND", "DNS_INDISPONIVEL"], ["EAI_AGAIN", "DNS_INDISPONIVEL"],
    ["ECONNREFUSED", "CONEXAO_RECUSADA"], ["ECONNRESET", "CONEXAO_INTERROMPIDA"],
    ["UND_ERR_CONNECT_TIMEOUT", "TEMPO_LIMITE"], ["CERT_HAS_EXPIRED", "CERTIFICADO_RECUSADO"],
    [segredo, "REDE_INDISPONIVEL"],
  ]) {
    const { api, logs } = cliente(async () => { throw new TypeError(segredo, { cause: { code, message: segredo } }); });
    await assert.rejects(api({ acao: "renovar" }), ErroComunicacaoFila);
    assert.equal(JSON.parse(logs[0]).motivo, motivo);
    assert.doesNotMatch(logs[0], /SECRET_TEST/);
  }
  const { api, logs } = cliente(async () => { throw new DOMException(segredo, "TimeoutError"); });
  await assert.rejects(api({ acao: "reservar" }), ErroComunicacaoFila);
  assert.equal(JSON.parse(logs[0]).motivo, "TEMPO_LIMITE");
});

test("diagnóstico mantém recuperação de transporte e interrupção por recusa no heartbeat", async () => {
  let chamadas = 0;
  const { api } = cliente(async () => {
    if (++chamadas === 1) throw new DOMException(segredo, "TimeoutError");
    return new Response(null, { status: 403 });
  });
  let agora = 0;
  const valida = await renovarEnquantoValida({
    iniciadaEm: 0, agora: () => agora, esperar: async (ms) => { agora += ms; },
    renovar: async (timeoutMs) => Boolean(await api({ acao: "renovar", reserva: segredo }, timeoutMs)),
    signal: new AbortController().signal,
  });
  assert.equal(valida, false);
  assert.equal(agora, 17_000);
  assert.equal(chamadas, 2);
});
