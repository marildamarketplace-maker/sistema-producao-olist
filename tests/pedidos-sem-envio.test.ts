import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../src/app/api/cron/alertar-pedidos-sem-envio/route";
import {
  FalhaPedidosSemEnvio, interpretarPaginaSemEnvio, mensagensPedidosSemEnvio, periodoSemEnvio,
  selecionarPedidosSemEnvio, type ReservaSemEnvio,
} from "../src/lib/pedidos-sem-envio";
import { criarClientePedidosSemEnvio } from "../src/lib/pedidos-sem-envio-olist";
import { executarPedidosSemEnvio, processarPaginaSemEnvio } from "../src/services/pedidosSemEnvioService";

const referencia = new Date("2026-11-18T00:00:00Z");
const pedido = { id: "123", numero: "456", situacao: 1, dataCriacao: "2026-11-12" };
const reserva: ReservaSemEnvio = { aplicativoId: "app-a", referencia, situacaoIndice: 0, paginaOffset: 100, reservaId: "reserva", tentativas: 1 };
const payload = { itens: [{ id: 123, numeroPedido: 456, situacao: 1, dataCriacao: "2026-11-12" }], paginacao: { total: 1 } };

test("corte é estritamente maior que cinco dias corridos e respeita São Paulo", () => {
  assert.deepEqual(periodoSemEnvio(new Date("2026-11-19T02:59:59Z")), { referencia: "2026-11-18", dataFinal: "2026-11-12" });
  assert.deepEqual(periodoSemEnvio(new Date("2026-11-19T03:00:00Z")), { referencia: "2026-11-19", dataFinal: "2026-11-13" });
  assert.deepEqual(periodoSemEnvio(new Date("2028-03-01T11:00:00Z")), { referencia: "2028-03-01", dataFinal: "2028-02-24" });
  assert.deepEqual(selecionarPedidosSemEnvio([
    pedido, { ...pedido, id: "2", situacao: 7 }, { ...pedido, id: "3", dataCriacao: "2026-11-13" },
    { ...pedido, id: "4", dataCriacao: "2026-11-19" },
    ...[0, 3, 4, 5, 6, 2, 9, 10].map(situacao => ({ ...pedido, situacao })),
  ], referencia).map(p => p.id), ["123", "2"]);
});

test("contrato da listagem descarta dados pessoais e falha fechado para dados inválidos", () => {
  assert.deepEqual(interpretarPaginaSemEnvio({ ...payload, itens: [{ ...payload.itens[0], cliente: { cpf: "privado" }, valor: 100 }] }), { pedidos: [pedido], total: 1 });
  for (const valor of [null, {}, { itens: [], paginacao: { total: -1 } }, { ...payload, itens: [payload.itens[0], payload.itens[0]] },
    ...[null, "2026-02-30", "inválida"].map(dataCriacao => ({ ...payload, itens: [{ ...payload.itens[0], dataCriacao }] })),
    { ...payload, itens: [{ ...payload.itens[0], id: Number.MAX_SAFE_INTEGER + 1 }] },
    { ...payload, itens: [{ ...payload.itens[0], situacao: null }] },
  ]) assert.throws(() => interpretarPaginaSemEnvio(valor), FalhaPedidosSemEnvio);
  const data = interpretarPaginaSemEnvio({ ...payload, itens: [{ ...payload.itens[0], dataCriacao: "2026-11-13T02:30:00Z" }] });
  assert.equal(data.pedidos[0].dataCriacao, "2026-11-12");
});

test("mensagens limitadas incluem todos os pedidos uma vez, situação, idade e criação", () => {
  const pedidos = Array.from({ length: 100 }, (_, i) => ({ ...pedido, id: String(i + 1), numero: String(1000 + i) }));
  const mensagens = mensagensPedidosSemEnvio(pedidos, referencia, "Meury Shop");
  assert.ok(mensagens.length > 1);
  assert.ok(mensagens.every(m => m.length <= 3_500));
  const texto = mensagens.join("\n");
  for (const p of pedidos) assert.equal(texto.split(`Pedido ${p.numero} (ID ${p.id})`).length, 2);
  assert.match(texto, /Faturada.*12\/11\/2026.*6 dias/);
  assert.deepEqual(mensagensPedidosSemEnvio([], referencia, "Meury"), []);
});

test("cliente envia filtros no servidor e renova um token rejeitado apenas uma vez", async () => {
  const chamadas: Array<{ url: string; token: string }> = [];
  const tokens: unknown[] = [];
  const cliente = criarClientePedidosSemEnvio({
    configurar: async id => { assert.equal(id, "app-a"); return { apiBaseUrl: "https://api.tiny.com.br/public-api/v3" }; },
    token: async (id, opcoes) => { tokens.push({ id, opcoes }); return opcoes ? "novo" : "antigo"; },
    http: async (url, token) => { chamadas.push({ url, token }); return { status: chamadas.length === 1 ? 401 : 200, data: payload }; },
  });
  assert.deepEqual(await cliente.listar("app-a", 7, 0, "2026-11-12"), { pedidos: [pedido], total: 1 });
  assert.equal(chamadas.length, 2);
  assert.equal(chamadas[1].token, "novo");
  assert.deepEqual(tokens[1], { id: "app-a", opcoes: { tokenRejeitado: "antigo" } });
  const url = new URL(chamadas[0].url);
  assert.equal(url.pathname, "/public-api/v3/pedidos");
  assert.deepEqual(Object.fromEntries(url.searchParams), { situacao: "7", offset: "0", limit: "100", orderBy: "asc", dataFinal: "2026-11-12" });
});

test("cliente limita retries e não expõe resposta ou credenciais em erros", async () => {
  for (const status of [401, 403, 429, 500]) {
    let chamadas = 0;
    const cliente = criarClientePedidosSemEnvio({ configurar: async () => ({ apiBaseUrl: "https://api.tiny.com.br/v3/" }), token: async () => "segredo",
      http: async () => { chamadas++; return { status, data: { segredo: "resposta privada" }, retryAfter: "300" }; },
    });
    await assert.rejects(cliente.listar("a", 1, 0, "2026-11-12"), (e: unknown) => {
      assert.ok(e instanceof FalhaPedidosSemEnvio);
      assert.equal(e.temporaria, status >= 429);
      assert.equal(e.retryAfterMs, 300_000);
      assert.doesNotMatch(e.message, /segredo|privada/);
      return true;
    });
    assert.equal(chamadas, status === 401 ? 2 : 1);
  }
  const vazio = criarClientePedidosSemEnvio({ configurar: async () => ({ apiBaseUrl: "https://api.tiny.com.br/v3/" }), token: async () => "t",
    http: async () => ({ status: 200, data: { itens: [], paginacao: { total: 10 } } }),
  });
  await assert.rejects(vazio.listar("a", 1, 0, "2026-11-12"), /PAGINACAO_INVALIDA/);
});

test("worker usa checkpoint, backoff e limite de tentativas por página", async () => {
  const falhas: unknown[] = [];
  const repo = { reservar: async () => null, salvarPagina: async () => ({ pedidos: 1, notificacoes: 1, concluido: false }),
    falhar: async (_r: ReservaSemEnvio, codigo: string, atraso: number | null) => { falhas.push([codigo, atraso]); return true; },
  };
  const cliente = { listar: async (app: string, situacao: number, offset: number, final: string) => {
    assert.deepEqual([app, situacao, offset, final], ["app-a", 1, 100, "2026-11-12"]);
    return { pedidos: [pedido], total: 101 };
  } };
  assert.deepEqual(await processarPaginaSemEnvio(repo, cliente, reserva), { pedidos: 1, notificacoes: 1, concluido: false });
  const indisponivel = { listar: async () => { throw new FalhaPedidosSemEnvio("OLIST_429", true, 120_000); } };
  await processarPaginaSemEnvio(repo, indisponivel, reserva);
  await processarPaginaSemEnvio(repo, indisponivel, { ...reserva, tentativas: 5 });
  await processarPaginaSemEnvio(repo, { listar: async () => { throw new FalhaPedidosSemEnvio("CONTRATO"); } }, reserva);
  assert.deepEqual(falhas, [["OLIST_429", 120_000], ["OLIST_429", null], ["CONTRATO", null]]);
});

test("rodada respeita prazo e cota de páginas sem marcar o restante concluído", async () => {
  let reservas = 0;
  const repo = { reservar: async () => { reservas++; return reserva; }, salvarPagina: async () => ({ pedidos: 0, notificacoes: 0, concluido: false }), falhar: async () => true };
  const cliente = { listar: async () => ({ pedidos: [], total: 0 }) };
  await executarPedidosSemEnvio(repo, cliente, { prazo: 70_000, agora: () => 0, esperar: async () => {} });
  assert.equal(reservas, 0);
  const resultado = await executarPedidosSemEnvio(repo, cliente, { prazo: 240_000, agora: () => 0, esperar: async () => {} });
  assert.equal(reservas, 100);
  assert.equal(resultado.paginas, 100);
  assert.equal(resultado.concluidos, 0);
});

test("cron recusa chamadas sem autenticação antes de acessar banco e Olist", async () => {
  const anterior = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await GET(new Request("https://local/cron"))).status, 401);
    process.env.CRON_SECRET = "teste";
    assert.equal((await GET(new Request("https://local/cron", { headers: { authorization: "Bearer errado" } }))).status, 401);
  } finally { if (anterior === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = anterior; }
});
