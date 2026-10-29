import assert from "node:assert/strict";
import test from "node:test";
import { criarCarregadorPaginasEstampas } from "../src/services/carregadorPaginasEstampas";

const parametros = (pagina: number, categoria = "botânico") => new URLSearchParams({ categoria, pagina: String(pagina), porPagina: "24", ordenacao: "RELEVANCIA" });
const resposta = (pagina: number) => Response.json({ estampas: [], total: 48, pagina, porPagina: 24, totalPaginas: 2, ordenacao: "RELEVANCIA", cobertura: null });

test("navegação reaproveita prefetch concluído e a página anterior", async () => {
  const chamadas: Array<{ url: string; opcoes?: RequestInit }> = [];
  const carregador = criarCarregadorPaginasEstampas("token-teste", async (url, opcoes) => {
    chamadas.push({ url: String(url), opcoes });
    return resposta(Number(new URL(String(url), "http://localhost").searchParams.get("pagina")));
  });
  await carregador.carregar(parametros(1));
  assert.equal(carregador.obterPronta(parametros(1))?.pagina, 1);
  const antecipada = await carregador.carregar(parametros(2));
  assert.deepEqual(await carregador.carregar(parametros(2)), antecipada);
  assert.equal((await carregador.carregar(parametros(1))).pagina, 1);
  assert.equal(chamadas.length, 2);
  assert.equal(chamadas[1].opcoes?.cache, "no-store");
  assert.deepEqual(chamadas[1].opcoes?.headers, { Authorization: "Bearer token-teste" });
});

test("clicar enquanto prefetch está pendente compartilha a mesma requisição", async () => {
  let concluir!: (resposta: Response) => void;
  let chamadas = 0;
  const carregador = criarCarregadorPaginasEstampas("token", async () => {
    chamadas++;
    return new Promise<Response>((resolve) => { concluir = resolve; });
  });
  const antecipada = carregador.carregar(parametros(2));
  const navegacao = carregador.carregar(parametros(2));
  assert.equal(antecipada, navegacao);
  await Promise.resolve();
  concluir(resposta(2));
  assert.equal((await navegacao).pagina, 2);
  assert.equal(chamadas, 1);
});

test("troca de filtro cancela a leitura anterior e não reaproveita outro escopo", async () => {
  const sinais: AbortSignal[] = [];
  let concluir!: (resposta: Response) => void;
  const carregador = criarCarregadorPaginasEstampas("token", async (_url, opcoes) => {
    sinais.push(opcoes!.signal!);
    if (sinais.length === 1) return new Promise<Response>((resolve) => { concluir = resolve; });
    return resposta(1);
  });
  const antiga = carregador.carregar(parametros(2));
  const rejeitada = assert.rejects(antiga, { name: "AbortError" });
  await Promise.resolve();
  const nova = carregador.carregar(parametros(1, "geométrico"));
  assert.equal(sinais[0].aborted, true);
  concluir(resposta(2));
  await rejeitada;
  assert.equal((await nova).pagina, 1);
});

test("erro de prefetch não fica no cache e permite tentar novamente", async () => {
  let chamadas = 0;
  const carregador = criarCarregadorPaginasEstampas("token", async () => {
    chamadas++;
    return chamadas === 1 ? Response.json({ error: "Sem permissão" }, { status: 403 }) : resposta(2);
  });
  await assert.rejects(carregador.carregar(parametros(2)), /Sem permissão/);
  assert.equal((await carregador.carregar(parametros(2))).pagina, 2);
  assert.equal(chamadas, 2);
});

test("cache local expira e mantém no máximo três páginas", async () => {
  let chamadas = 0, agora = 0;
  const carregador = criarCarregadorPaginasEstampas("token", async () => { chamadas++; return resposta(1); }, () => agora);
  await carregador.carregar(parametros(1));
  agora = 59_999;
  await carregador.carregar(parametros(1));
  assert.equal(chamadas, 1);
  agora = 60_001;
  assert.equal(carregador.obterPronta(parametros(1)), null);
  await carregador.carregar(parametros(1));
  assert.equal(chamadas, 2);
  for (const pagina of [2, 3, 4]) await carregador.carregar(parametros(pagina));
  await carregador.carregar(parametros(1));
  assert.equal(chamadas, 6);
});

test("limpar cancela requisições pendentes e sessões não compartilham páginas", async () => {
  let chamadas = 0;
  const requisitar: typeof fetch = async () => { chamadas++; return resposta(1); };
  const primeira = criarCarregadorPaginasEstampas("sessao-1", requisitar);
  const segunda = criarCarregadorPaginasEstampas("sessao-2", requisitar);
  await primeira.carregar(parametros(1));
  await segunda.carregar(parametros(1));
  assert.equal(chamadas, 2);
  const pendente = primeira.carregar(parametros(2));
  const rejeitada = assert.rejects(pendente, { name: "AbortError" });
  primeira.limpar();
  await rejeitada;
  await primeira.carregar(parametros(1));
  assert.equal(chamadas, 3);
});
