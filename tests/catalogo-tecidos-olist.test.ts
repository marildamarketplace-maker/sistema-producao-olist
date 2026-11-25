import assert from "node:assert/strict";
import test from "node:test";
import { carregarLoteCatalogoTecidosOlist, chaveCatalogoTecidosOlist, type LoteCatalogoTecidosOlist } from "../src/lib/catalogo-tecidos-olist";

const vazio = (): LoteCatalogoTecidosOlist => ({ itens: [], proximaPagina: 1, completo: false });
const produto = (id: number) => ({ id, nome: `Tecido Ref. ${id}`, referencia: String(id), preco: 18.99 });

test("catálogo Ref carrega páginas sequenciais, deduplica ID e conserva nome e preço", async () => {
  const chamadas: number[] = [], progresso: number[] = [];
  const lote = await carregarLoteCatalogoTecidosOlist({ anterior: vazio(), signal: new AbortController().signal,
    carregar: async pagina => {
      chamadas.push(pagina);
      return { itens: pagina === 1 ? [produto(1), produto(2)] : [produto(2), produto(3)], pagina, mais: pagina === 1 };
    }, aoCarregar: lote => progresso.push(lote.itens.length),
  });
  assert.deepEqual(chamadas, [1, 2]);
  assert.deepEqual(progresso, [2, 3]);
  assert.deepEqual(lote, { itens: [produto(1), produto(2), produto(3)], proximaPagina: 3, completo: true });
  await carregarLoteCatalogoTecidosOlist({ anterior: lote, signal: new AbortController().signal, carregar: async () => assert.fail("Não recarrega catálogo completo") });
});

test("limite por carga preserva lista incompleta e continuação começa na próxima página", async () => {
  const chamadas: number[] = [];
  const carregar = async (pagina: number) => { chamadas.push(pagina); return { itens: [produto(pagina)], pagina, mais: pagina < 3 }; };
  const parcial = await carregarLoteCatalogoTecidosOlist({ anterior: vazio(), signal: new AbortController().signal, carregar, limitePaginas: 2 });
  assert.deepEqual(chamadas, [1, 2]);
  assert.equal(parcial.completo, false);
  assert.equal(parcial.proximaPagina, 3);
  const completo = await carregarLoteCatalogoTecidosOlist({ anterior: parcial, signal: new AbortController().signal, carregar });
  assert.deepEqual(chamadas, [1, 2, 3]);
  assert.deepEqual(completo.itens.map(item => item.id), [1, 2, 3]);
  assert.equal(completo.completo, true);
});

test("falha não avança a página pendente e permite retomar a partir do último progresso", async () => {
  let ultimo = vazio();
  await assert.rejects(carregarLoteCatalogoTecidosOlist({ anterior: ultimo, signal: new AbortController().signal,
    carregar: async pagina => {
      if (pagina === 2) throw new Error("Olist indisponível");
      return { itens: [produto(1)], pagina, mais: true };
    }, aoCarregar: lote => { ultimo = lote; },
  }), /Olist indisponível/);
  assert.deepEqual(ultimo, { itens: [produto(1)], proximaPagina: 2, completo: false });
  const chamadas: number[] = [];
  const retomado = await carregarLoteCatalogoTecidosOlist({ anterior: ultimo, signal: new AbortController().signal,
    carregar: async pagina => { chamadas.push(pagina); return { itens: [produto(2)], pagina, mais: false }; },
  });
  assert.deepEqual(chamadas, [2]);
  assert.equal(retomado.itens.length, 2);
  assert.equal(retomado.completo, true);
});

test("cancelamento anterior ou durante a consulta impede publicar e buscar outras páginas", async () => {
  const antes = new AbortController(); antes.abort();
  await assert.rejects(carregarLoteCatalogoTecidosOlist({ anterior: vazio(), signal: antes.signal, carregar: async () => assert.fail("Consulta após abort") }), { name: "AbortError" });
  const durante = new AbortController();
  let chamadas = 0;
  await assert.rejects(carregarLoteCatalogoTecidosOlist({ anterior: vazio(), signal: durante.signal,
    carregar: async pagina => { chamadas++; durante.abort(); return { itens: [produto(1)], pagina, mais: true }; },
    aoCarregar: () => assert.fail("Publicou resposta cancelada"),
  }), { name: "AbortError" });
  assert.equal(chamadas, 1);
});

test("páginas filtradas vazias não encerram a carga e catálogo vazio completo para imediatamente", async () => {
  const chamadas: number[] = [];
  const lote = await carregarLoteCatalogoTecidosOlist({ anterior: vazio(), signal: new AbortController().signal,
    carregar: async pagina => { chamadas.push(pagina); return { itens: [], pagina, mais: pagina === 1 }; },
  });
  assert.deepEqual(chamadas, [1, 2]);
  assert.deepEqual(lote, { itens: [], proximaPagina: 3, completo: true });
});

test("página repetida e contrato inválido interrompem carga sem anunciar completude", async () => {
  let ultimo = vazio();
  await assert.rejects(carregarLoteCatalogoTecidosOlist({ anterior: ultimo, signal: new AbortController().signal,
    carregar: async pagina => ({ itens: [produto(1)], pagina, mais: true }), aoCarregar: lote => { ultimo = lote; },
  }), /repetiu uma página/);
  assert.equal(ultimo.proximaPagina, 2);
  assert.equal(ultimo.completo, false);
  await assert.rejects(carregarLoteCatalogoTecidosOlist({ anterior: vazio(), signal: new AbortController().signal,
    carregar: async () => ({ itens: [produto(1)], pagina: 2, mais: false }),
  }), /pesquisa inválida/);
});

test("limites inválidos e teto de página impedem chamadas remotas", async () => {
  for (const limitePaginas of [0, 1.5, 21]) await assert.rejects(carregarLoteCatalogoTecidosOlist({ anterior: vazio(), signal: new AbortController().signal,
    carregar: async () => assert.fail("Não deve consultar"), limitePaginas,
  }), /Limite/);
  await assert.rejects(carregarLoteCatalogoTecidosOlist({ anterior: { ...vazio(), proximaPagina: 1001 }, signal: new AbortController().signal,
    carregar: async () => assert.fail("Não deve consultar"),
  }), /limite de páginas/);
});

test("identidade do catálogo ignora somente assinatura e mantém usuário, token, conta e origem", () => {
  const original = chaveCatalogoTecidosOlist("/api/pedidos?aplicativoId=a&clienteOrigemId=1&contextoConsulta=antigo", "u1", "token1");
  assert.equal(chaveCatalogoTecidosOlist("/api/pedidos?contextoConsulta=novo&clienteOrigemId=1&aplicativoId=a", "u1", "token1"), original);
  for (const [api, usuario, token] of [
    ["/api/pedidos?aplicativoId=b&clienteOrigemId=1", "u1", "token1"],
    ["/api/pedidos?aplicativoId=a&clienteOrigemId=2", "u1", "token1"],
    ["/api/outro?aplicativoId=a&clienteOrigemId=1", "u1", "token1"],
    ["/api/pedidos?aplicativoId=a&clienteOrigemId=1", "u2", "token1"],
    ["/api/pedidos?aplicativoId=a&clienteOrigemId=1", "u1", "token2"],
  ]) assert.notEqual(chaveCatalogoTecidosOlist(api, usuario, token), original);
});
