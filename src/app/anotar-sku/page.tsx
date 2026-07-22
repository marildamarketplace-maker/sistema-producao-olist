"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { AccessGuard } from "@/components/access-guard";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/components/auth-provider";

const SITUACOES = [
  { value: "8", label: "8 - Dados Incompletos" }, { value: "0", label: "0 - Aberta" },
  { value: "3", label: "3 - Aprovada" }, { value: "4", label: "4 - Preparando Envio" },
  { value: "1", label: "1 - Faturada" }, { value: "7", label: "7 - Pronto Envio" },
  { value: "5", label: "5 - Enviada" }, { value: "6", label: "6 - Entregue" },
  { value: "2", label: "2 - Cancelada" }, { value: "9", label: "9 - Não Entregue" },
];

const NOMES_SITUACOES = new Map(
  SITUACOES.map((situacao) => [situacao.value, situacao.label.replace(/^\d+\s*-\s*/, "")]),
);

type Busca = {
  id: string;
  situacoes: string[];
  quantidadePedidos: number;
  quantidadeSkus: number;
  createdAt: string;
};

type DetalheBusca = Busca & {
  pedidos: string[];
  skus: Array<{ sku: string; tituloProduto: string | null; quantidade: number }>;
};

export default function AnotarSkuPage() {
  const { session } = useAuth();
  const [selecionadas, setSelecionadas] = useState(["0"]);
  const [buscas, setBuscas] = useState<Busca[]>([]);
  const [detalhe, setDetalhe] = useState<DetalheBusca | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const headers = useCallback(() => ({ Authorization: `Bearer ${session?.access_token ?? ""}` }), [session?.access_token]);

  const carregarBuscas = useCallback(async () => {
    if (!session?.access_token) return;
    setCarregando(true);
    try {
      const response = await fetch("/api/olist/anotar-sku", { headers: headers(), cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Não foi possível carregar as buscas.");
      setBuscas(payload.buscas ?? []);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível carregar as buscas.");
    } finally {
      setCarregando(false);
    }
  }, [headers, session?.access_token]);

  useEffect(() => { void carregarBuscas(); }, [carregarBuscas]);

  useEffect(() => {
    if (!buscando) return;

    function confirmarSaida(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", confirmarSaida);
    return () => window.removeEventListener("beforeunload", confirmarSaida);
  }, [buscando]);

  function alternarSituacao(situacao: string) {
    setSelecionadas((atuais) => atuais.includes(situacao) ? atuais.filter((item) => item !== situacao) : [...atuais, situacao]);
  }

  async function buscar() {
    if (!session?.access_token || selecionadas.length === 0) return;
    setBuscando(true);
    setErro(null);
    setMensagem(null);
    try {
      const response = await fetch("/api/olist/anotar-sku", {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ situacoes: selecionadas }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Não foi possível salvar a busca.");
      setMensagem(payload.pedidosNovos > 0
        ? `Busca salva com ${payload.pedidosNovos} pedido(s) novo(s).`
        : "Nenhum pedido novo foi encontrado. Os pedidos já salvos não foram repetidos.");
      await carregarBuscas();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível salvar a busca.");
    } finally {
      setBuscando(false);
    }
  }

  async function visualizar(buscaId: string) {
    setErro(null);
    try {
      const response = await fetch(`/api/olist/anotar-sku?id=${encodeURIComponent(buscaId)}`, { headers: headers(), cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Não foi possível abrir a busca.");
      setDetalhe(payload.busca);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível abrir a busca.");
    }
  }

  async function baixarArquivo(buscaId: string, formato: "csv" | "xlsx" | "pdf") {
    setErro(null);
    try {
      const response = await fetch(`/api/olist/anotar-sku?id=${encodeURIComponent(buscaId)}&formato=${formato}`, { headers: headers() });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Não foi possível baixar o arquivo.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `anotar-sku-${buscaId}.${formato}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível baixar o arquivo.");
    }
  }

  async function excluirBusca(busca: Busca) {
    const data = new Date(busca.createdAt).toLocaleString("pt-BR");
    if (!window.confirm(`Excluir a busca de ${data} e todos os pedidos vinculados? Os pedidos poderão ser buscados novamente.`)) return;

    setExcluindoId(busca.id);
    setErro(null);
    setMensagem(null);
    try {
      const response = await fetch(`/api/olist/anotar-sku?id=${encodeURIComponent(busca.id)}`, {
        method: "DELETE",
        headers: headers(),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Não foi possível excluir a busca.");
      if (detalhe?.id === busca.id) setDetalhe(null);
      setMensagem("Busca excluída. Os pedidos desse grupo podem ser buscados novamente.");
      await carregarBuscas();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível excluir a busca.");
    } finally {
      setExcluindoId(null);
    }
  }

  return (
    <AccessGuard permissions={["podeSolicitarProducao", "podeVisualizarProducao"]}>
      <div className="space-y-8">
        <PageHeader title="Anotar SKU" description="Consulte pedidos novos da Olist e mantenha um histórico por SKU." />

        {erro && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
        {mensagem && <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{mensagem}</p>}

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="flex max-w-md flex-col gap-3">
            <div className="text-sm text-slate-700">
              <span className="font-medium">Situações consultadas</span>
              <div className="mt-2 grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                {SITUACOES.map((situacao) => (
                  <label key={situacao.value} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-100">
                    <input type="checkbox" checked={selecionadas.includes(situacao.value)} onChange={() => alternarSituacao(situacao.value)} className="h-4 w-4 rounded border-slate-300" />
                    {situacao.label}
                  </label>
                ))}
              </div>
            </div>
            <button type="button" onClick={() => void buscar()} disabled={buscando || selecionadas.length === 0 || !session?.access_token} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {buscando ? "Buscando... Pode demorar" : "Buscar (pode demorar)"}
            </button>
            <p className="text-xs text-slate-500">Mantenha esta aba aberta até a busca terminar.</p>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Histórico de buscas</h2>
          {carregando ? <p className="text-sm text-slate-500">Carregando...</p> : buscas.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma busca salva.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-slate-200 text-slate-600"><th className="px-3 py-2">Data</th><th className="px-3 py-2">Situações</th><th className="px-3 py-2">Pedidos</th><th className="px-3 py-2">SKUs</th><th className="px-3 py-2 text-right">Ações</th></tr></thead>
                <tbody>{buscas.map((busca) => (
                  <tr key={busca.id} className="border-b border-slate-100 last:border-0">
                    <td className="whitespace-nowrap px-3 py-3">{new Date(busca.createdAt).toLocaleString("pt-BR")}</td>
                    <td className="px-3 py-3">{busca.situacoes.map((situacao) => NOMES_SITUACOES.get(situacao) ?? situacao).join(", ")}</td>
                    <td className="px-3 py-3">{busca.quantidadePedidos}</td>
                    <td className="px-3 py-3">{busca.quantidadeSkus}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right">
                      <button type="button" onClick={() => void visualizar(busca.id)} className="mr-2 rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">Visualizar</button>
                      <button type="button" onClick={() => void baixarArquivo(busca.id, "csv")} className="mr-2 rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white">CSV</button>
                      <button type="button" onClick={() => void baixarArquivo(busca.id, "xlsx")} className="mr-2 rounded-md bg-emerald-700 px-3 py-1.5 font-medium text-white">Excel</button>
                      <button type="button" onClick={() => void baixarArquivo(busca.id, "pdf")} className="mr-2 rounded-md bg-red-700 px-3 py-1.5 font-medium text-white">PDF</button>
                      <button type="button" onClick={() => void excluirBusca(busca)} disabled={excluindoId === busca.id} className="rounded-md border border-red-200 px-3 py-1.5 font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">{excluindoId === busca.id ? "Excluindo..." : "Excluir"}</button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {detalhe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label="Detalhes da busca">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><h2 className="font-semibold text-slate-900">Detalhes da busca</h2><p className="text-xs text-slate-500">{new Date(detalhe.createdAt).toLocaleString("pt-BR")}</p></div><button type="button" onClick={() => setDetalhe(null)} aria-label="Fechar" className="rounded-md p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
            <div className="max-h-[calc(90vh-72px)] overflow-y-auto p-5">
              <p className="mb-4 text-sm text-slate-600"><strong>Pedidos:</strong> {detalhe.pedidos.join(", ")}</p>
              <table className="w-full text-left text-sm"><thead><tr className="border-b border-slate-200"><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Título do produto</th><th className="px-3 py-2 text-right">QTD</th></tr></thead><tbody>{detalhe.skus.map((item) => <tr key={item.sku} className="border-b border-slate-100 last:border-0"><td className="px-3 py-2 font-medium">{item.sku}</td><td className="px-3 py-2 text-slate-600">{item.tituloProduto || "—"}</td><td className="px-3 py-2 text-right font-semibold">{item.quantidade}</td></tr>)}</tbody></table>
            </div>
          </div>
        </div>
      )}
    </AccessGuard>
  );
}
