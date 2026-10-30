import assert from "node:assert/strict";
import "./helpers/next-cache";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { validarPreferenciasPesquisa } from "../src/domain/preferencias-pesquisa-estampas";
import { copiarFiltrosPesquisaEstampas, criarQueryPesquisaEstampas, FILTROS_VAZIOS_PESQUISA_ESTAMPAS, lerEstadoUrlPesquisaEstampas, temFiltroPesquisaEstampas } from "../src/services/filtrosPesquisaEstampas";

test("código, variante, status e controles não podem virar preferências", () => {
  for (const campo of ["codigo", "variante", "status", "somenteAtivas", "ordenacao", "correspondenciaMinima"]) assert.throws(() => validarPreferenciasPesquisa([campo]), /inválidas/);
  assert.deepEqual(validarPreferenciasPesquisa(["estilo", "cores", "estilo"]), ["estilo", "cores"]);
});

test("link mantém escolhas, vazio explícito e compatibilidade com links anteriores", () => {
  for (const preferencias of [[], ["consulta"], ["estilo", "cores", "linguagemVisual"]]) {
    const filtros = { ...FILTROS_VAZIOS_PESQUISA_ESTAMPAS, estilo: "romântico", preferencias };
    assert.deepEqual(lerEstadoUrlPesquisaEstampas(criarQueryPesquisaEstampas(filtros, 2, "RELEVANCIA")).filtros, filtros);
    const copia = copiarFiltrosPesquisaEstampas(filtros);
    copia.preferencias.push("densidade");
    assert.notDeepEqual(copia.preferencias, filtros.preferencias);
  }
  assert.deepEqual(lerEstadoUrlPesquisaEstampas(new URLSearchParams("q=floral")).filtros.preferencias, ["consulta"]);
  assert.equal(lerEstadoUrlPesquisaEstampas(new URLSearchParams("estilo=romântico&preferencias=estilo")).ordenacao, "RELEVANCIA");
  assert.equal(temFiltroPesquisaEstampas(FILTROS_VAZIOS_PESQUISA_ESTAMPAS), false);
});

const consultas: Prisma.Sql[] = [];
let respostaContagem = { total: BigInt(0), completas: BigInt(0), parciais: BigInt(0) };
let respostaEstampas: Record<string, unknown>[] = [];
Object.assign(globalThis, { prisma: {
  $queryRaw(strings: TemplateStringsArray, ...valores: unknown[]) {
    const sql = Prisma.sql(strings, ...valores);
    consultas.push(sql);
    return Promise.resolve(sql.sql.includes("COUNT(*)::BIGINT") ? [respostaContagem] : respostaEstampas);
  },
  $transaction: (operacoes: Promise<unknown>[]) => Promise.all(operacoes),
} });

test("preferências estruturadas entram no percentual sem pesquisa geral", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  consultas.length = 0;
  const resultado = await pesquisarEstampasCatalogo({ estilo: "romântico", cores: ["amarelo"], linguagemVisual: "aquarelado", preferencias: ["cores", "linguagemVisual"] });
  assert.deepEqual(resultado.cobertura?.termos, ["Cores: amarelo", "Linguagem visual: aquarelado"]);
  assert.equal(resultado.ordenacao, "RELEVANCIA");
  assert.match(consultas[0].sql, /ORDER BY aderencia.percentual DESC/);
  assert.match(consultas[0].sql, /WHERE lower\(e.estilo\) = lower\(\?\) AND e.is_active = TRUE/);
  for (const sql of consultas) {
    assert.ok(sql.values.includes("COMPLETED"));
    assert.match(sql.sql, /aderencia.percentual >=/);
  }
});

test("pesquisa geral pode ser obrigatória; só preferências selecionadas pontuam", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  consultas.length = 0;
  const resultado = await pesquisarEstampasCatalogo({ consulta: "cereja amarela -texto", estilo: "romântico", preferencias: ["estilo"] });
  assert.deepEqual(resultado.cobertura?.termos, ["Estilo: romântico"]);
  assert.deepEqual(resultado.cobertura?.excluidos, ["texto"]);
  assert.match(consultas[0].sql, /AND NOT/);
  assert.ok(consultas[0].values.includes('"cereja"'));
  assert.ok(consultas[0].values.includes('"amarelo" OR "amarela" OR "amarelos" OR "amarelas"'));
});

test("sem preferências ativas o resultado não inventa percentual", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  consultas.length = 0;
  const resultado = await pesquisarEstampasCatalogo({ consulta: "cereja amarela", preferencias: [] });
  assert.equal(resultado.cobertura, null);
  assert.doesNotMatch(consultas[0].sql, /aderencia.percentual >=/);
  const codigo = await pesquisarEstampasCatalogo({ consulta: "MV27849-B", preferencias: ["consulta"] });
  assert.equal(codigo.cobertura, null);
});

test("código digitado no texto e exclusões são obrigatórios mesmo com preferências", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  consultas.length = 0;
  const resultado = await pesquisarEstampasCatalogo({ consulta: "MV27849-B floral -texto", estilo: "romântico", preferencias: ["consulta", "estilo"] });
  assert.deepEqual(resultado.cobertura?.termos, ["floral", "Estilo: romântico"]);
  for (const sql of consultas) {
    assert.match(sql.sql, /lower\(e.codigo\) = lower/);
    assert.match(sql.sql, /e.variante/);
    assert.match(sql.sql, /AND NOT/);
    assert.ok(sql.values.includes("MV27849"));
  }
});

test("serviço rejeita tentativas de relaxar status antes de consultar o banco", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  consultas.length = 0;
  await assert.rejects(pesquisarEstampasCatalogo({ consulta: "floral", preferencias: ["status"] }), /inválidas/);
  assert.equal(consultas.length, 0);
});

test("cada filtro de conteúdo tem um predicado de preferência e mantém status obrigatório", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  const exemplos = {
    tema: "floral", cores: ["amarelo"], palavraChave: "flor", elementoVisual: "flor", categoria: "botânico",
    ocasiao: "casamento", publicoSugerido: "adulto", contextoUso: "decoração", afinidadeVisual: "romântico",
    padraoTextil: "floral", estilo: "romântico", distribuicao: "corrido", orientacao: "vertical", densidade: "densa",
    linguagemVisual: "aquarelado", aplicacaoSugerida: "vestuário", tipoImagem: "ESTAMPA", suporteAplicacao: "MODELO_REAL", conteudoImagem: "ESTAMPA",
  };
  for (const [campo, valor] of Object.entries(exemplos)) {
    consultas.length = 0;
    const resultado = await pesquisarEstampasCatalogo({ [campo]: valor, preferencias: [campo] });
    assert.equal(resultado.cobertura?.termos.length, 1, campo);
    assert.match(consultas[0].sql, /aderencia.percentual >=/, campo);
    assert.match(consultas[0].sql, /e.processing_status =/, campo);
    assert.ok(consultas[0].values.includes("COMPLETED"), campo);
  }
});

test("categoria obrigatória usa inclusão indexável parametrizada na lista e contagem", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  for (const categoria of ["BOTÂNICO", "  Geométrico  ", "'); DROP TABLE estampas; --"]) {
    consultas.length = 0;
    await pesquisarEstampasCatalogo({ categoria, preferencias: [] });
    assert.equal(consultas.length, 2);
    for (const sql of consultas) {
      assert.match(sql.sql, /e\.categorias @> ARRAY\[lower\(\?\)\]::TEXT\[\]/);
      assert.doesNotMatch(sql.sql, /unnest\(e\.categorias\)|DROP TABLE/);
      assert.ok(sql.values.includes(categoria.trim()));
      assert.ok(sql.values.includes("COMPLETED"));
    }
  }
});

test("categoria preferencial mantém cobertura e não altera os outros filtros exatos ou parciais", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  consultas.length = 0;
  const resultado = await pesquisarEstampasCatalogo({
    categoria: "BOTÂNICO", preferencias: ["categoria"], correspondenciaMinima: 100,
    elementoVisual: "folha", palavraChave: "flor",
  });
  assert.deepEqual(resultado.cobertura?.termos, ["Categoria: BOTÂNICO"]);
  assert.equal(resultado.cobertura?.minima, 100);
  for (const sql of consultas) {
    assert.match(sql.sql, /e\.categorias @> ARRAY\[lower\(\?\)\]::TEXT\[\]/);
    assert.match(sql.sql, /aderencia\.percentual >=/);
    assert.doesNotMatch(sql.sql, /unnest\(e\.categorias\)/);
    assert.match(sql.sql, /unnest\(e\.elementos_visuais\)/);
    assert.match(sql.sql, /unnest\(e\.palavras_chave\)/);
    assert.match(sql.sql, /LIKE/);
  }
  consultas.length = 0;
  await pesquisarEstampasCatalogo({ categoria: " ", elementoVisual: "folha" });
  for (const sql of consultas) assert.doesNotMatch(sql.sql, /e\.categorias @>/);
});

test("categoria compartilha seleção com a contagem em ambos os modos e preserva todas as ordenações e paginação", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  for (const preferencias of [[], ["categoria"]]) {
    for (const ordenacao of ["RELEVANCIA", "RECENTES", "CODIGO_ASC", "CODIGO_DESC"]) {
      consultas.length = 0;
      const resultado = await pesquisarEstampasCatalogo({
        categoria: "BOTÂNICO", preferencias, ordenacao, pagina: 3, porPagina: 12,
      });
      const [lista, contagem] = consultas;
      const selecaoLista = lista.sql.slice(lista.sql.indexOf("FROM estampas AS e")).split("ORDER BY")[0].trim();
      const selecaoContagem = contagem.sql.slice(contagem.sql.indexOf("FROM estampas AS e")).trim();
      assert.equal(selecaoLista.replace(/\s+/g, " "), selecaoContagem.replace(/\s+/g, " "));
      const trechoSelecao = lista.text.slice(lista.text.indexOf("FROM estampas AS e")).split("ORDER BY")[0];
      const trechoContagem = contagem.text.slice(contagem.text.indexOf("FROM estampas AS e"));
      const parametros = (sql: Prisma.Sql, trecho: string) => [...trecho.matchAll(/\$(\d+)/g)].map((m) => sql.values[Number(m[1]) - 1]);
      assert.deepEqual(parametros(lista, trechoSelecao), parametros(contagem, trechoContagem));
      const paginacao = lista.text.match(/LIMIT (\$\d+)\s+OFFSET (\$\d+)/)!;
      assert.deepEqual(parametros(lista, paginacao[0]), [12, 24]);
      // O JSON e os detalhes são projetados somente após selecionar a página.
      const cte = lista.sql.slice(0, lista.sql.indexOf(")\n      SELECT"));
      assert.match(cte, /WITH pagina AS MATERIALIZED/);
      assert.doesNotMatch(cte, /ai_metadata|AS "atributosDesign"|e\.descricao/);
      assert.match(lista.sql, /INNER JOIN pagina ON pagina.id = e.id/);
      assert.doesNotMatch(contagem.sql, /LIMIT|OFFSET|ORDER BY/);
      const ordemEsperada = ordenacao === "CODIGO_ASC"
        ? "ORDER BY lower(e.codigo) ASC, lower(COALESCE(e.variante, '')) ASC, e.id ASC"
        : ordenacao === "CODIGO_DESC"
          ? "ORDER BY lower(e.codigo) DESC, lower(COALESCE(e.variante, '')) DESC, e.id DESC"
          : ordenacao === "RELEVANCIA" && preferencias.length
            ? "ORDER BY aderencia.percentual DESC, relevancia DESC, e.updated_at DESC, e.id DESC"
            : "ORDER BY e.created_at DESC, e.id DESC";
      assert.ok(lista.sql.includes(ordemEsperada));
      assert.ok(lista.sql.slice(lista.sql.lastIndexOf("ORDER BY")).includes(ordemEsperada.replace("aderencia.percentual", "pagina.percentual")));
      assert.equal(resultado.pagina, 3);
      assert.equal(resultado.porPagina, 12);
      assert.equal(resultado.ordenacao, ordenacao);
      if (!preferencias.length) assert.equal(resultado.cobertura, null);
    }
  }
});

test("categoria e cor pontuam separadamente sem transformar preferência em obrigação", async (t) => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  respostaContagem = { total: BigInt(25), completas: BigInt(9), parciais: BigInt(16) };
  respostaEstampas = [{
    id: BigInt(1), createdAt: new Date(0), updatedAt: null, processedAt: null,
    processingStatus: "COMPLETED", relevancia: 0, atributosDesign: null,
    percentualCorrespondencia: 50, termosEncontrados: ["Cores: rosa"], termosAusentes: ["Categoria: BOTÂNICO"],
  }];
  t.after(() => {
    respostaContagem = { total: BigInt(0), completas: BigInt(0), parciais: BigInt(0) };
    respostaEstampas = [];
  });
  consultas.length = 0;
  const resultado = await pesquisarEstampasCatalogo({
    categoria: "BOTÂNICO", cores: ["rosa"], preferencias: ["categoria", "cores"],
    correspondenciaMinima: 50, pagina: 2, porPagina: 12,
  });
  assert.deepEqual(resultado.cobertura, {
    termos: ["Categoria: BOTÂNICO", "Cores: rosa"], excluidos: [], minima: 50, completas: 9, parciais: 16,
  });
  assert.deepEqual(resultado.estampas[0].correspondencia, {
    percentual: 50, termosEncontrados: ["Cores: rosa"], termosAusentes: ["Categoria: BOTÂNICO"],
  });
  assert.equal(resultado.total, 25);
  assert.equal(resultado.totalPaginas, 3);
  // A preferência de categoria aceita candidatos que correspondem somente à cor.
  for (const sql of consultas) {
    assert.match(sql.sql, /COALESCE\(\(e\.categorias @> ARRAY\[lower\(\?\)\]::TEXT\[\]\), FALSE\) OR COALESCE\(\(e\.cores @>/);
    assert.match(sql.sql, /100\.0 \/ \?/);
    assert.ok(sql.values.includes(2));
    assert.match(sql.sql, /e\.is_active = TRUE AND e\.processing_status =/);
  }
});

test("palavra-chave continua parcial; cores TODAS/QUALQUER e conteúdo preservam operadores nos dois modos", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  for (const preferencias of [[], ["palavraChave", "cores", "conteudoImagem"]]) {
    for (const modoCores of ["TODAS", "QUALQUER"]) {
      consultas.length = 0;
      await pesquisarEstampasCatalogo({
        palavraChave: "Flor", cores: ["rosa", "creme"], conteudoImagem: "ESTAMPA", modoCores, preferencias,
      });
      for (const sql of consultas) {
        assert.match(sql.sql, /unnest\(e\.palavras_chave\)/);
        assert.ok(sql.sql.includes("lower(item) LIKE '%' || lower(?) || '%'"));
        assert.ok(sql.sql.includes(modoCores === "TODAS" ? "e.cores @> ARRAY" : "e.cores && ARRAY"));
        assert.match(sql.sql, /e\.conteudos_imagem @> ARRAY\[\?\]::TEXT\[\]/);
      }
    }
  }
});
