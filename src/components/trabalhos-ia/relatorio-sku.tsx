"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { MenuArquivos } from "@/components/menu-arquivos";
import { TabelaSkus } from "@/components/tabela-skus";
import { alternarOrdenacaoSku, ORDENACAO_SKU_PADRAO } from "@/lib/anotar-sku/ordenacao";
import type { TrabalhoIaResumo } from "@/lib/trabalhos-ia/contrato";
import { requisicaoIa, trabalhoIaAtivo } from "@/hooks/use-trabalhos-ia";
import { botaoIa, DialogoIa, primarioIa } from "./dialogo";
import { StatusTrabalhoIa } from "./status";

type Relatorio = { id: string; total: number; revisaoConfig: number; finalizadoEm: string; proximaPagina: number | null; itens: { sku: string; produto: string; tecido: string; quantidade: number }[] };
const endpoint = (busca: string) => `/api/olist/anotar-sku/${busca}/relatorio-ia`;
function VisualizarRelatorio({ busca, trabalho, token, fechar }: { busca: string; trabalho: string; token: string; fechar: () => void }) {
  const [consulta, setConsulta] = useState({ offset: 0, ordem: ORDENACAO_SKU_PADRAO });
  const { offset, ordem } = consulta;
  const [resposta, setResposta] = useState<{ consulta: typeof consulta; relatorio: Relatorio } | null>(null);
  const relatorio = resposta?.relatorio, paginaAtual = resposta?.consulta === consulta;
  const [erro, setErro] = useState(""), [carregando, setCarregando] = useState(true), [baixando, setBaixando] = useState("");
  const [recarregar, setRecarregar] = useState(0), [mensagem, setMensagem] = useState("");
  const download = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); setCarregando(true); setErro("");
    const parametros = new URLSearchParams({ trabalho, offset: String(consulta.offset), ordenarPor: consulta.ordem.coluna, direcao: consulta.ordem.direcao });
    requisicaoIa<Relatorio>(token, `${endpoint(busca)}?${parametros}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) })
      .then(d => { if (!controller.signal.aborted) setResposta({ consulta, relatorio: d }); }).catch(e => { if (!controller.signal.aborted) setErro(e.message); }).finally(() => { if (!controller.signal.aborted) setCarregando(false); });
    return () => controller.abort();
  }, [token, busca, trabalho, consulta, recarregar]);
  async function baixar(formato: string) {
    if (download.current) return;
    download.current = true; setBaixando(formato); setErro(""); setMensagem("");
    try {
      const parametros = new URLSearchParams({ trabalho, formato, ordenarPor: ordem.coluna, direcao: ordem.direcao });
      const resposta = await fetch(`${endpoint(busca)}?${parametros}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
      if (!resposta.ok) throw new Error((await resposta.json()).error ?? "Não foi possível baixar o relatório.");
      const url = URL.createObjectURL(await resposta.blob()), a = document.createElement("a");
      a.href = url; a.download = `relatorio-ia-${trabalho}.${formato}`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); setMensagem("Download iniciado.");
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha no download."); }
    finally { download.current = false; setBaixando(""); }
  }
  return <DialogoIa titulo="Relatório IA" fechar={fechar}>
    {carregando && <p role="status" className="text-sm text-slate-600">Carregando relatório…</p>}
    {erro && <div role="alert" className="mb-4 space-y-2 text-sm text-red-700"><p>{erro}</p><button type="button" className={botaoIa} onClick={() => setRecarregar(v => v+1)}>Tentar carregar novamente</button></div>}
    {relatorio && <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">{relatorio.total} SKUs · Quantidades dos pedidos</p>
      <MenuArquivos baixar={formato => void baixar(formato)} desabilitado={relatorio.total > 10000 || carregando || !paginaAtual} baixando={Boolean(baixando)} rotulo="Arquivos IA" /></div>
      {relatorio.total > 10000 && <p className="text-sm text-amber-800">A exportação aceita até 10.000 SKUs. Todos os itens estão disponíveis nesta consulta paginada.</p>}
      <TabelaSkus nome="Tabela do relatório IA" comTecido itens={paginaAtual ? relatorio.itens : []} ordem={ordem} carregando={carregando} ordenar={coluna => setConsulta(atual => ({ offset: 0, ordem: alternarOrdenacaoSku(atual.ordem, coluna) }))} />
      <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" className={botaoIa} disabled={carregando || !paginaAtual || offset === 0} onClick={() => setConsulta(atual => ({ ...atual, offset: Math.max(0, atual.offset - 50) }))}>Anterior</button><p className="text-sm text-slate-600">Página {Math.floor(offset / 50) + 1} de {Math.max(1, Math.ceil(relatorio.total / 50))}</p><button type="button" className={botaoIa} disabled={carregando || !paginaAtual || relatorio.proximaPagina === null} onClick={() => setConsulta(atual => ({ ...atual, offset: relatorio.proximaPagina! }))}>Próxima</button></div>
    </div>}{mensagem && <p role="status" className="mt-3 text-sm text-slate-600">{mensagem}</p>}
  </DialogoIa>;
}

export function RelatorioSkuIa({ busca, token, escopo, podeEscrever, temItens, trabalhos, atualizar }: {
  busca: string; token: string; escopo: string; podeEscrever: boolean; temItens: boolean; trabalhos: TrabalhoIaResumo[]; atualizar: () => void;
}) {
  const ultimo = trabalhos[0], ativo = trabalhoIaAtivo(ultimo);
  const [ocupado, setOcupado] = useState(false), [erro, setErro] = useState(""), [aberto, setAberto] = useState(false), [confirmarCancelamento, setConfirmarCancelamento] = useState(false);
  const [local, setLocal] = useState<TrabalhoIaResumo | null>(null);
  const concluido = trabalhos.find(t => t.status === "CONCLUIDO") ?? (local?.status === "CONCLUIDO" ? local : undefined);
  const bloqueio = useRef(false), chaveMemoria = useRef<string | null>(null);
  const storage = `relatorio-ia:${escopo}:${busca}`;
  const exibido = local && (!ultimo || new Date(local.criadoEm) > new Date(ultimo.criadoEm)) ? local : ultimo;
  const gerando = ativo || trabalhoIaAtivo(exibido);
  async function acao(tipo: "gerar" | "cancelar" | "retomar") {
    if (bloqueio.current || (concluido && tipo !== "cancelar")) return;
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
  if (!exibido && !concluido && (!podeEscrever || !temItens)) return null;
  return <div className={`flex min-w-0 flex-wrap items-center gap-3 ${gerando || (!concluido && exibido?.status === "FALHOU") ? "basis-full" : ""}`}>
    {exibido && (!concluido || gerando) && <StatusTrabalhoIa trabalho={exibido} />}
    <div className="flex flex-wrap gap-2">
      {podeEscrever && !concluido && !gerando && exibido?.status !== "FALHOU" && <button type="button" className={botaoIa} disabled={ocupado || !temItens} onClick={() => void acao("gerar")}><Sparkles className="h-4 w-4" aria-hidden="true" />{ocupado ? "Registrando…" : "Gerar relatório IA"}</button>}
      {podeEscrever && !concluido && exibido?.status === "FALHOU" && <button type="button" className={botaoIa} disabled={ocupado} onClick={() => void acao("retomar")}>Retomar relatório IA</button>}
      {podeEscrever && gerando && <button type="button" className={botaoIa} disabled={ocupado} onClick={() => setConfirmarCancelamento(true)}>Cancelar relatório IA</button>}
      {concluido && <button type="button" className={botaoIa} onClick={() => setAberto(true)}><Sparkles className="h-4 w-4" aria-hidden="true" />Ver relatório IA</button>}
    </div>
    {erro && <p role="alert" className="break-words text-sm text-red-700">{erro}</p>}
    {aberto && concluido && <VisualizarRelatorio busca={busca} trabalho={concluido.id} token={token} fechar={() => setAberto(false)} />}
    {confirmarCancelamento && <DialogoIa titulo="Cancelar relatório IA?" fechar={() => { if (!ocupado) setConfirmarCancelamento(false); }}><p className="text-sm text-slate-700">A geração atual será encerrada. Relatórios já concluídos continuam disponíveis.</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" className={botaoIa} disabled={ocupado} onClick={() => setConfirmarCancelamento(false)}>Voltar</button><button type="button" className={primarioIa} disabled={ocupado} onClick={() => void acao("cancelar")}>{ocupado ? "Cancelando…" : "Confirmar cancelamento"}</button></div>{erro && <p role="alert" className="mt-3 text-sm text-red-700">{erro}</p>}</DialogoIa>}
  </div>;
}
