"use client";
import { useEffect, useRef, useState } from "react";
import { Download, Sparkles } from "lucide-react";
import type { TrabalhoIaResumo } from "@/lib/trabalhos-ia/contrato";
import { requisicaoIa, trabalhoIaAtivo } from "@/hooks/use-trabalhos-ia";
import { botaoIa, DialogoIa, primarioIa } from "./dialogo";
import { StatusTrabalhoIa } from "./status";

type Relatorio = { id: string; total: number; revisaoConfig: number; finalizadoEm: string; proximaPagina: number | null; itens: { sku: string; produto: string; tecido: string; quantidade: number }[] };
const endpoint = (busca: string) => `/api/olist/anotar-sku/${busca}/relatorio-ia`;
function VisualizarRelatorio({ busca, trabalho, token, fechar }: { busca: string; trabalho: string; token: string; fechar: () => void }) {
  const [offset, setOffset] = useState(0), [relatorio, setRelatorio] = useState<Relatorio | null>(null), [erro, setErro] = useState(""), [carregando, setCarregando] = useState(true), [baixando, setBaixando] = useState("");
  const [recarregar, setRecarregar] = useState(0), [mensagem, setMensagem] = useState("");
  const download = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); setCarregando(true); setErro("");
    requisicaoIa<Relatorio>(token, `${endpoint(busca)}?trabalho=${trabalho}&offset=${offset}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) })
      .then(d => { if (!controller.signal.aborted) setRelatorio(d); }).catch(e => { if (!controller.signal.aborted) setErro(e.message); }).finally(() => { if (!controller.signal.aborted) setCarregando(false); });
    return () => controller.abort();
  }, [token, busca, trabalho, offset, recarregar]);
  async function baixar(formato: string) {
    if (download.current) return;
    download.current = true; setBaixando(formato); setErro(""); setMensagem("");
    try {
      const resposta = await fetch(`${endpoint(busca)}?trabalho=${trabalho}&formato=${formato}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
      if (!resposta.ok) throw new Error((await resposta.json()).error ?? "Não foi possível baixar o relatório.");
      const url = URL.createObjectURL(await resposta.blob()), a = document.createElement("a");
      a.href = url; a.download = `relatorio-ia-${trabalho}.${formato}`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); setMensagem("Download iniciado.");
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha no download."); }
    finally { download.current = false; setBaixando(""); }
  }
  return <DialogoIa titulo="Relatório IA" fechar={fechar}>
    {carregando && <p role="status" className="text-sm text-slate-600">Carregando relatório…</p>}
    {erro && <div role="alert" className="mb-4 space-y-2 text-sm text-red-700"><p>{erro}</p><button type="button" className={botaoIa} onClick={() => setRecarregar(v => v+1)}>Tentar carregar novamente</button></div>}
    {relatorio && <div className="space-y-4"><p className="text-sm text-slate-600">{relatorio.total} SKUs · Instruções versão {relatorio.revisaoConfig} · Revisão concluída. Quantidades originais dos pedidos, sem multiplicar peças de kits.</p>
      <div className="flex flex-wrap gap-2">{["csv", "xlsx", "pdf"].map(f => <button key={f} type="button" className={botaoIa} disabled={Boolean(baixando) || relatorio.total > 10000} onClick={() => void baixar(f)}><Download className="h-4 w-4" aria-hidden="true" />{baixando === f ? "Baixando…" : f === "xlsx" ? "Excel IA" : `${f.toUpperCase()} IA`}</button>)}</div>
      {relatorio.total > 10000 && <p className="text-sm text-amber-800">A exportação aceita até 10.000 SKUs. Todos os itens estão disponíveis nesta consulta paginada.</p>}
      <div className="space-y-3 sm:hidden" aria-label="Itens do relatório IA" aria-busy={carregando}>{relatorio.itens.map(item => <article key={item.sku} className="rounded-md border border-slate-200 p-3 text-sm text-slate-900">
        <dl className="space-y-2"><div><dt className="text-xs text-slate-500">SKU do pedido</dt><dd className="break-words font-medium">{item.sku}</dd></div><div><dt className="text-xs text-slate-500">Produto</dt><dd className="break-words">{item.produto}</dd></div><div className="flex items-start justify-between gap-4"><div className="min-w-0"><dt className="text-xs text-slate-500">Tecido</dt><dd className="break-words font-medium">{item.tecido}</dd></div><div><dt className="text-xs text-slate-500">Qtd</dt><dd className="text-right font-semibold tabular-nums">{item.quantidade}</dd></div></div></dl>
      </article>)}</div>
      <div className="hidden overflow-x-auto rounded-md border border-slate-200 sm:block" tabIndex={0} role="region" aria-label="Tabela do relatório IA" aria-busy={carregando}><table className="w-full min-w-[600px] text-left text-sm"><thead className="bg-slate-50 text-slate-700"><tr>{["SKU do pedido", "Produto", "Tecido", "Qtd"].map(h => <th key={h} scope="col" className="p-3">{h}</th>)}</tr></thead><tbody>{relatorio.itens.map(item => <tr key={item.sku} className="border-t border-slate-200 text-slate-900"><td className="max-w-56 break-words p-3">{item.sku}</td><td className="min-w-48 max-w-96 break-words p-3">{item.produto}</td><td className="max-w-48 break-words p-3">{item.tecido}</td><td className="p-3 text-right tabular-nums">{item.quantidade}</td></tr>)}</tbody></table></div>
      <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" className={botaoIa} disabled={carregando || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Anterior</button><p className="text-sm text-slate-600">Página {Math.floor(offset / 50) + 1} de {Math.max(1, Math.ceil(relatorio.total / 50))}</p><button type="button" className={botaoIa} disabled={carregando || relatorio.proximaPagina === null} onClick={() => setOffset(relatorio.proximaPagina!)}>Próxima</button></div>
    </div>}{mensagem && <p role="status" className="mt-3 text-sm text-slate-600">{mensagem}</p>}
  </DialogoIa>;
}

export function RelatorioSkuIa({ busca, token, escopo, podeEscrever, temItens, trabalhos, atualizar }: {
  busca: string; token: string; escopo: string; podeEscrever: boolean; temItens: boolean; trabalhos: TrabalhoIaResumo[]; atualizar: () => void;
}) {
  const ultimo = trabalhos[0], concluido = trabalhos.find(t => t.status === "CONCLUIDO"), ativo = trabalhoIaAtivo(ultimo);
  const [ocupado, setOcupado] = useState(false), [erro, setErro] = useState(""), [aberto, setAberto] = useState(false), [confirmarCancelamento, setConfirmarCancelamento] = useState(false);
  const [local, setLocal] = useState<TrabalhoIaResumo | null>(null);
  const bloqueio = useRef(false), chaveMemoria = useRef<string | null>(null);
  const storage = `relatorio-ia:${escopo}:${busca}`;
  const exibido = local && (!ultimo || new Date(local.criadoEm) > new Date(ultimo.criadoEm)) ? local : ultimo;
  const gerando = ativo || trabalhoIaAtivo(exibido);
  async function acao(tipo: "gerar" | "cancelar" | "retomar") {
    if (bloqueio.current) return;
    bloqueio.current = true; setOcupado(true); setErro("");
    try {
      if (tipo === "gerar") {
        let chave = chaveMemoria.current;
        try { chave ??= localStorage.getItem(storage); } catch { /* Storage opcional. */ }
        chave ??= crypto.randomUUID(); chaveMemoria.current = chave;
        try { localStorage.setItem(storage, chave); } catch { /* Mantida em memória até a confirmação. */ }
        const dados = await requisicaoIa<{ trabalho: TrabalhoIaResumo }>(token, endpoint(busca), { method: "POST", body: JSON.stringify({ chave }) });
        setLocal(dados.trabalho); chaveMemoria.current = null;
        try { localStorage.removeItem(storage); } catch { /* Storage opcional. */ }
      } else if (exibido) {
        await requisicaoIa(token, `/api/trabalhos-ia/${exibido.id}`, { method: "PATCH", body: JSON.stringify({ acao: tipo }) });
        setLocal({ ...exibido, status: tipo === "cancelar" ? "CANCELADO" : "PENDENTE" });
      }
      setConfirmarCancelamento(false); atualizar();
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao solicitar relatório."); }
    finally { bloqueio.current = false; setOcupado(false); }
  }
  return <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
    {exibido && <StatusTrabalhoIa trabalho={exibido} />}
    {gerando && <p className="text-xs text-slate-500">Você pode sair desta tela. O relatório continua em segundo plano.</p>}
    {concluido && ultimo?.id !== concluido.id && <p className="text-xs text-slate-600">O relatório anterior permanece disponível durante a nova geração.</p>}
    <div className="flex flex-wrap gap-2">
      {podeEscrever && !gerando && <button type="button" className={primarioIa} disabled={ocupado || !temItens} onClick={() => void acao("gerar")}><Sparkles className="h-4 w-4" aria-hidden="true" />{ocupado ? "Registrando…" : concluido ? "Gerar novo relatório IA" : "Gerar relatório IA"}</button>}
      {podeEscrever && exibido?.status === "FALHOU" && <button type="button" className={botaoIa} disabled={ocupado} onClick={() => void acao("retomar")}>Retomar relatório IA</button>}
      {podeEscrever && gerando && <button type="button" className={botaoIa} disabled={ocupado} onClick={() => setConfirmarCancelamento(true)}>Cancelar relatório IA</button>}
      {concluido && <button type="button" className={botaoIa} onClick={() => setAberto(true)}>Ver relatório IA</button>}
    </div>
    {erro && <p role="alert" className="break-words text-sm text-red-700">{erro}</p>}
    {aberto && concluido && <VisualizarRelatorio busca={busca} trabalho={concluido.id} token={token} fechar={() => setAberto(false)} />}
    {confirmarCancelamento && <DialogoIa titulo="Cancelar relatório IA?" fechar={() => { if (!ocupado) setConfirmarCancelamento(false); }}><p className="text-sm text-slate-700">A geração atual será encerrada. Relatórios já concluídos continuam disponíveis.</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" className={botaoIa} disabled={ocupado} onClick={() => setConfirmarCancelamento(false)}>Voltar</button><button type="button" className={primarioIa} disabled={ocupado} onClick={() => void acao("cancelar")}>{ocupado ? "Cancelando…" : "Confirmar cancelamento"}</button></div>{erro && <p role="alert" className="mt-3 text-sm text-red-700">{erro}</p>}</DialogoIa>}
  </div>;
}
