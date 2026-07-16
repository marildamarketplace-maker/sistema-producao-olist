"use client";

import { useEffect, useMemo, useState } from "react";

type Plano = { id: string; nome: string };

type Props = {
  accessToken: string;
  tipo: "pagamento" | "recebimento";
  forma: { id: string; nome: string };
  onClose: () => void;
};

function normalizar(valor: string) {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function planosSugeridos(nomeForma: string, planos: Plano[]) {
  const forma = normalizar(nomeForma);
  const aceitaParcelamento = forma.includes("boleto") || forma.includes("cheque");
  const aceitaAVista = [
    "dinheiro",
    "cartao de credito",
    "cartao de debito",
    "deposito",
    "crediario",
    "vale-troca",
    "vale troca",
    "pix",
    "cashback",
    "vale-presente",
    "vale presente",
  ].some((nome) => forma.includes(nome));

  if (!aceitaParcelamento && !aceitaAVista) return [];

  return planos
    .filter((plano) => aceitaParcelamento || normalizar(plano.nome) === "a vista")
    .map((plano) => plano.id);
}

export function ModalAssociarPlanosPagamento({ accessToken, tipo, forma, onClose }: Props) {
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    async function carregar() {
      setCarregando(true);
      setErro(null);
      try {
        const params = new URLSearchParams({ tipo, formaOlistId: forma.id });
        const response = await fetch(`/api/olist/planos-pagamento?${params}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await response.json() as {
          planos?: Plano[];
          planoIdsAssociados?: string[];
          error?: string;
        };
        if (!response.ok) throw new Error(data.error ?? "Não foi possível consultar os planos.");
        if (!ativo) return;
        const opcoes = data.planos ?? [];
        setPlanos(opcoes);
        setSelecionados(
          data.planoIdsAssociados?.length
            ? data.planoIdsAssociados
            : planosSugeridos(forma.nome, opcoes),
        );
      } catch (error) {
        if (ativo) setErro(error instanceof Error ? error.message : "Erro inesperado.");
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    void carregar();
    return () => { ativo = false; };
  }, [accessToken, forma.id, forma.nome, tipo]);

  const planosFiltrados = useMemo(() => {
    const termo = normalizar(busca);
    return termo ? planos.filter((plano) => normalizar(plano.nome).includes(termo)) : planos;
  }, [busca, planos]);

  function alternar(id: string) {
    setSelecionados((atuais) => atuais.includes(id)
      ? atuais.filter((item) => item !== id)
      : [...atuais, id]);
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const response = await fetch("/api/olist/planos-pagamento", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tipo,
          formaOlistId: forma.id,
          formaOlistNome: forma.nome,
          planoIds: selecionados,
        }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível salvar as associações.");
      onClose();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="titulo-associar-planos">
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <h2 id="titulo-associar-planos" className="text-lg font-semibold text-slate-900">Associar planos de pagamento</h2>
            <p className="mt-1 text-sm text-slate-500">{forma.nome} — ID {forma.id}</p>
          </div>
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Fechar">×</button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <input value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Pesquisar plano" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          {erro && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}
          {carregando ? <p className="py-6 text-center text-sm text-slate-500">Carregando planos...</p> : (
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {planosFiltrados.map((plano) => (
                <label key={plano.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 px-3 py-2.5 hover:bg-slate-50">
                  <input type="checkbox" checked={selecionados.includes(plano.id)} onChange={() => alternar(plano.id)} className="h-4 w-4 rounded border-slate-300" />
                  <span className="text-sm text-slate-800">{plano.nome}</span>
                </label>
              ))}
              {planosFiltrados.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Nenhum plano encontrado.</p>}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={() => void salvar()} disabled={carregando || salvando} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{salvando ? "Salvando..." : "Salvar associação"}</button>
        </div>
      </div>
    </div>
  );
}
