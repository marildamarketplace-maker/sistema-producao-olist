import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Paginacao, type PaginacaoProps } from "../src/components/paginacao";

const base = { pagina: 1, onAnterior: () => {}, onProxima: () => {} };
const renderizar = (props: Partial<PaginacaoProps>) => renderToStaticMarkup(React.createElement(Paginacao, { ...base, ...props }));
test("paginação apresenta limites, carregamento e total opcional", () => {
  assert.match(renderizar({ totalPaginas: 3 }), /Página 1 de 3/);
  assert.match(renderizar({ totalPaginas: 3 }), /disabled="">Anterior/);
  assert.doesNotMatch(renderizar({ pagina: 2, totalPaginas: 3 }), /disabled=/);
  assert.match(renderizar({ pagina: 3, totalPaginas: 3 }), /disabled="">Próxima/);
  assert.equal((renderizar({ carregando: true, totalPaginas: 3 }).match(/disabled=/g) ?? []).length, 2);
  assert.match(renderizar({ pagina: 2, temProxima: true }), /Página 2<\/p>/);
  assert.match(renderizar({ totalPaginas: 0 }), /Página 1 de 1/);
  assert.match(renderizar({ rotulo: "Histórico" }), /aria-label="Histórico"/);
});
