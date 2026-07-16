"use client";

import { useEffect, useMemo, useState } from "react";

export type TipoProdutoOpcao = {
  id: string;
  codigo: string;
  nome: string;
};

export function CampoTipoProduto({
  opcoes,
  valor,
  onChange,
  disabled = false,
}: {
  opcoes: TipoProdutoOpcao[];
  valor: string;
  onChange: (valor: string) => void;
  disabled?: boolean;
}) {
  const [busca, setBusca] = useState(valor);
  const [aberto, setAberto] = useState(false);

  useEffect(() => setBusca(valor), [valor]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    if (!termo) return opcoes;
    return opcoes.filter((opcao) =>
      [opcao.codigo, opcao.nome].some((texto) =>
        texto.toLocaleLowerCase("pt-BR").includes(termo),
      ),
    );
  }, [busca, opcoes]);

  return (
    <div className="relative">
      <input
        value={busca}
        disabled={disabled}
        placeholder="Pesquise por nome ou código"
        onFocus={() => setAberto(true)}
        onBlur={() => window.setTimeout(() => setAberto(false), 150)}
        onChange={(event) => {
          setBusca(event.target.value);
          onChange(event.target.value);
          setAberto(true);
        }}
        className="w-full rounded-md border border-slate-300 px-3 py-2 disabled:bg-slate-100 disabled:text-slate-500"
      />
      {aberto && !disabled && (
        <div className="absolute z-40 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {filtradas.map((opcao) => (
            <button
              key={opcao.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setBusca(opcao.codigo);
                onChange(opcao.codigo);
                setAberto(false);
              }}
              className="block w-full border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50"
            >
              <span className="block text-sm font-medium text-slate-900">{opcao.nome}</span>
            </button>
          ))}
          {filtradas.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-500">
              Nenhum cadastro encontrado. O texto digitado será enviado como valor personalizado.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
