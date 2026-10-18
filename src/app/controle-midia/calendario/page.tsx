"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Megaphone, PackagePlus } from "lucide-react";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { carregarCalendario } from "./actions";
import {
  MESES, REGIOES, escreverFiltros, mesAtualBrasil,
  lerFiltros, montarPlanejamento, type Evento, type Etapa, type Filtros, type Ocorrencia,
} from "@/lib/calendario-comercial/planejamento";

const controle = "min-h-11 rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500";

function ItemEvento({ ocorrencia, regioes }: { ocorrencia: Ocorrencia; regioes: Filtros["regioes"] }) {
  const { evento } = ocorrencia;
  const destaques = evento.destaques?.filter((d) => regioes.includes(d.regiao));
  return <li className="min-w-0 rounded-md border border-slate-200 bg-white p-3 text-sm">
    <p className="font-medium text-slate-900">{evento.nome}</p>
    <p className="mt-2 inline-flex flex-wrap gap-x-2 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">Potencial de compra: {evento.potencialCompra.nivel} · {evento.potencialCompra.publico}</p>
    <p className="mt-1 text-xs text-slate-600">{ocorrencia.periodo} · {evento.local ?? evento.regioes.join(", ")}</p>
    {ocorrencia.variavel && <p className="mt-1 text-xs text-amber-700">Data variável: confirmar o calendário da edição. A janela indicada não representa duração do evento.</p>}
    {ocorrencia.referencia && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">Confirmar programação da edição · período de referência</p>}
    <p className="mt-2 text-xs font-medium text-slate-700">{evento.produtos.join(" · ")}</p>
    <p className="mt-1 text-sm text-slate-600">{evento.estampas}</p>
    <details className="mt-2">
      <summary className="flex min-h-11 cursor-pointer items-center rounded-md text-sm font-medium text-slate-700 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500">Recomendações e fontes<span className="sr-only"> de {evento.nome}</span></summary>
      <div className="space-y-2 pt-2 text-xs text-slate-600">
        <p><strong>Potencial de compra — {evento.potencialCompra.nivel}:</strong> {evento.potencialCompra.justificativa}</p>
        <p>{evento.recomendacao}</p>
        {destaques?.map((d) => <p key={d.regiao}><strong>{d.regiao}:</strong> {d.texto}</p>)}
        <p>Categoria: {evento.categoria}. Divulgação sugerida: {evento.divulgacao === "ambos" ? "mês anterior e durante o período" : evento.divulgacao === "anterior" ? "mês anterior" : "durante o período"}.</p>
        <ul>{evento.fontes.map((f) => <li key={f.url}><a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center break-words underline underline-offset-4 focus-visible:outline focus-visible:outline-2">{f.titulo}<span className="sr-only"> (abre em nova aba)</span></a></li>)}</ul>
        <p>Fontes contextualizam a celebração; sugestões de produtos, estampas e antecedência são recomendações comerciais.</p>
      </div>
    </details>
  </li>;
}

function EventosModal({ mes, titulo, itens, regioes, onFechar }: {
  mes: number; titulo: string; itens: Ocorrencia[]; regioes: Filtros["regioes"]; onFechar: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fecharRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const focoAnterior = document.activeElement;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    fecharRef.current?.focus();
    return () => {
      dialog?.close();
      document.body.style.overflow = overflowAnterior;
      if (focoAnterior instanceof HTMLElement && focoAnterior.isConnected) focoAnterior.focus();
    };
  }, []);
  return <dialog ref={dialogRef} aria-modal="true" aria-labelledby="titulo-eventos-modal" aria-describedby="descricao-eventos-modal"
    onCancel={(e) => { e.preventDefault(); onFechar(); }}
    className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-4 backdrop:bg-slate-950/40">
    <div className="flex min-h-full items-center justify-center">
      <div className="flex max-h-[90dvh] w-full max-w-4xl flex-col rounded-lg border border-slate-200 bg-white text-slate-900 shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
          <div className="min-w-0"><h2 id="titulo-eventos-modal" className="text-lg font-semibold">{MESES[mes - 1]} · {titulo}</h2><p id="descricao-eventos-modal" className="mt-1 text-sm text-slate-600">Todos os {itens.length} itens desta etapa, considerando os filtros selecionados.</p></div>
          <button ref={fecharRef} type="button" onClick={onFechar} className={`${controle} shrink-0 hover:bg-slate-50`}>Fechar</button>
        </header>
        <div className="min-h-0 overflow-y-auto p-4 sm:p-5"><ul className="grid items-start gap-3 md:grid-cols-2">{itens.map((o) => <ItemEvento key={o.evento.id} ocorrencia={o} regioes={regioes} />)}</ul></div>
      </div>
    </div>
  </dialog>;
}

function CalendarioConteudo() {
  const { session, usuario } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mesAtual] = useState(() => mesAtualBrasil());
  const focarDetalhes = useRef(false);
  const filtros = lerFiltros(new URLSearchParams(searchParams.toString()), mesAtual);
  const [catalogo, setCatalogo] = useState<{ token: string; eventos: Evento[] } | null>(null);
  const [erro, setErro] = useState("");
  const [tentativa, setTentativa] = useState(0);
  const [modal, setModal] = useState<{ mes: number; etapa: Etapa } | null>(null);
  const token = session?.access_token;
  const permitido = Boolean(usuario?.podeVisualizarTarefasMidia);

  useEffect(() => {
    if (!token || !permitido) return;
    let vigente = true;
    setErro("");
    carregarCalendario(token).then((resultado) => {
      if (!vigente) return;
      if (resultado.ok) setCatalogo({ token, eventos: resultado.eventos });
      else setErro(resultado.erro);
    }).catch(() => {
      if (vigente) setErro("Não foi possível carregar o calendário. Tente novamente.");
    });
    return () => { vigente = false; };
  }, [token, permitido, tentativa]);

  const eventos = catalogo && catalogo.token === token && permitido ? catalogo.eventos : null;
  // O cálculo é pequeno; a string da URL representa todos os filtros compartilháveis.
  const consulta = searchParams.toString();
  useEffect(() => { setModal(null); }, [consulta]);
  const meses = useMemo(() => montarPlanejamento(eventos ?? [], lerFiltros(new URLSearchParams(consulta), mesAtual)), [eventos, consulta, mesAtual]);
  const possuiResultados = meses.some((m) => m.cadastrar.length || m.divulgar.length || m.acontecendo.length);

  function atualizar(alteracoes: Partial<Filtros>) {
    router.replace(`${pathname}?${escreverFiltros({ ...filtros, ...alteracoes })}`, { scroll: false });
  }
  function selecionarMes(mes: number, etapa: Etapa = filtros.etapa, focar = false) {
    focarDetalhes.current = focar;
    atualizar({ mes, etapa, visao: "mensal" });
    if (focar && filtros.visao === "mensal" && mes === filtros.mes && etapa === filtros.etapa) {
      const detalhe = document.getElementById("planejamento-mes");
      detalhe?.scrollIntoView({ block: "start" });
      detalhe?.focus({ preventScroll: true });
    }
  }
  useEffect(() => {
    if (!focarDetalhes.current) return;
    focarDetalhes.current = false;
    const detalhe = document.getElementById("planejamento-mes");
    detalhe?.scrollIntoView({ block: "start" });
    detalhe?.focus({ preventScroll: true });
  }, [filtros.mes, filtros.etapa, filtros.visao]);
  const selecionado = meses[filtros.mes - 1];
  const etapas = [
    { id: "cadastrar" as const, titulo: "Cadastrar produtos", curto: "Cadastro", Icone: PackagePlus, cor: "border-l-emerald-600" },
    { id: "divulgar" as const, titulo: "Reforçar divulgação", curto: "Divulgação", Icone: Megaphone, cor: "border-l-amber-600" },
    { id: "acontecendo" as const, titulo: "Celebrações e temporadas", curto: "Celebrações", Icone: CalendarDays, cor: "border-l-slate-500" },
  ];

  return <div className="min-w-0 space-y-6">
    <PageHeader title="Calendário Comercial" description="Planejamento fixo de janeiro a dezembro: produtos, divulgação e celebrações." />
    <section aria-label="Planejamento do calendário" className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="titulo-planejamento" className="text-xl font-semibold text-slate-900">{filtros.visao === "mensal" ? `Planejamento de ${MESES[filtros.mes - 1].toLocaleLowerCase("pt-BR")}` : "Planejamento anual"}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="visao-calendario">Visualização do calendário</label>
          <select id="visao-calendario" value={filtros.visao} onChange={(e) => atualizar({ visao: e.target.value as Filtros["visao"] })} className={`${controle} min-w-0 bg-white text-slate-900`}><option value="mensal">Mensal</option><option value="anual">Anual</option></select>
          <label className="sr-only" htmlFor="abrangencia-calendario">Abrangência</label>
          <select id="abrangencia-calendario" value={filtros.regioes[filtros.regioes.length - 1]} onChange={(e) => atualizar({ regioes: e.target.value === "Nacional" ? ["Nacional"] : ["Nacional", e.target.value as Filtros["regioes"][number]] })} className={`${controle} min-w-0 bg-white text-slate-900`}>{REGIOES.map((regiao) => <option key={regiao}>{regiao}</option>)}</select>
          {filtros.visao === "mensal" && <div className="flex gap-2"><button type="button" aria-label="Mês anterior" onClick={() => selecionarMes((filtros.mes + 10) % 12 + 1)} className={controle}><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button><button type="button" aria-label="Próximo mês" onClick={() => selecionarMes(filtros.mes % 12 + 1)} className={controle}><ChevronRight aria-hidden="true" className="h-4 w-4" /></button></div>}
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">A região selecionada inclui os eventos nacionais.</p>

    <div className="mt-5">
    {erro ? <div role="alert" className="rounded-lg border border-red-200 bg-white p-5 text-sm text-red-700"><p>{erro}</p><button type="button" onClick={() => { setCatalogo(null); setTentativa((v) => v + 1); }} className={`${controle} mt-3`}>Tentar novamente</button></div>
      : !eventos ? <p role="status" className="p-5 text-sm text-slate-600">Carregando calendário...</p>
      : <>
        {!possuiResultados && <p role="status" className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">Nenhum evento encontrado. Selecione outra abrangência.</p>}
        {filtros.visao === "anual" && <div className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label="Calendário anual">
          {meses.map((mes) => <section key={mes.mes} aria-labelledby={`mes-${mes.mes}`} className={`min-w-0 bg-white p-4 ${mes.mes === filtros.mes ? "ring-2 ring-inset ring-slate-400" : ""}`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 id={`mes-${mes.mes}`} className="text-lg font-semibold text-slate-900"><button type="button" onClick={() => selecionarMes(mes.mes, filtros.etapa, true)} className="min-h-11 rounded-md text-left focus-visible:outline focus-visible:outline-2">{MESES[mes.mes - 1]}</button></h2>
              {mes.mes === mesAtual && <span className="text-xs text-slate-500">Atual</span>}
            </div>
            <div className="space-y-3">{etapas.map(({ id, curto, cor }) => <div key={id}>
              <button type="button" onClick={() => selecionarMes(mes.mes, id, true)} className="flex min-h-11 w-full items-center justify-between rounded-md text-xs font-semibold text-slate-600 focus-visible:outline focus-visible:outline-2"><span>{curto}</span><span>{mes[id].length}</span></button>
              <ul className="space-y-1">{mes[id].slice(0, 2).map((o) => <li key={o.evento.id}><button type="button" onClick={() => selecionarMes(mes.mes, id, true)} className={`min-h-11 w-full break-words rounded border-l-4 bg-slate-50 px-2 py-1.5 text-left text-xs leading-relaxed text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 ${cor}`}>{o.evento.nome}<span className="mt-1 block text-xs text-slate-500">Compra: {o.evento.potencialCompra.nivel} · {o.evento.potencialCompra.publico}</span></button></li>)}</ul>
              {mes[id].length > 2 && <button type="button" aria-haspopup="dialog" aria-label={`Ver todos os ${mes[id].length} itens de ${curto} de ${MESES[mes.mes - 1]}`} onClick={() => setModal({ mes: mes.mes, etapa: id })} className="min-h-11 rounded-md text-xs text-slate-600 underline focus-visible:outline focus-visible:outline-2">Ver mais {mes[id].length - 2}</button>}
              {!mes[id].length && <p className="py-2 text-xs text-slate-500">Sem itens previstos</p>}
            </div>)}</div>
          </section>)}
        </div>}
        {filtros.visao === "mensal" && <section id="planejamento-mes" tabIndex={-1} aria-labelledby="titulo-planejamento" className="scroll-mt-4 outline-offset-4">
          <div className="my-4 flex flex-wrap gap-2" aria-label="Etapa do planejamento">{etapas.map(({ id, titulo, Icone }) => <button key={id} type="button" aria-pressed={filtros.etapa === id} onClick={() => atualizar({ etapa: id })} className={`${controle} flex items-center gap-2 ${filtros.etapa === id ? "bg-slate-900 text-white" : ""}`}><Icone aria-hidden="true" className="h-4 w-4" />{titulo} ({selecionado[id].length})</button>)}</div>
          <p role="status" className="mb-4 text-sm text-slate-600">{selecionado[filtros.etapa].length} itens · {etapas.find((e) => e.id === filtros.etapa)?.titulo}</p>
          {selecionado[filtros.etapa].length ? <ul className="grid items-start gap-3 lg:grid-cols-2">{selecionado[filtros.etapa].map((o) => <ItemEvento key={o.evento.id} ocorrencia={o} regioes={filtros.regioes} />)}</ul> : <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-500">Nenhum item previsto nesta etapa. Selecione outra etapa, mês ou abrangência.</p>}
        </section>}
      </>}
    </div>
    </section>
    <details className="rounded-lg border border-slate-200 bg-white p-4"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-slate-700">Como interpretar os níveis de compra</summary><div className="space-y-2 text-sm text-slate-600"><p>Estimativa editorial para lenços, pareôs, forros de mesa e painéis. Não mede percentual de adesão da população, intenção de compra pesquisada ou vendas comprovadas.</p><p><strong>Muito alto:</strong> prioridade de coleção no mix. <strong>Alto:</strong> boa oportunidade no público indicado. <strong>Moderado:</strong> testar seleção e lotes direcionados. <strong>Baixo:</strong> priorizar encomendas e demanda identificada.</p><p>O público indicado é essencial: um nível alto regional não significa procura alta em todo o Brasil. Níveis de campanhas não avaliam a importância social da causa. Recalibrar com o histórico real da loja.</p><p>Contexto de mercado: <a className="underline" target="_blank" rel="noopener noreferrer" href="https://agenciasebrae.com.br/economia-e-politica/retorno-presencial-de-festas-juninas-aquece-mercado-dos-pequenos-negocios/">Sebrae — oportunidades juninas em vestuário e decoração</a>. A fonte não atribui estes níveis: a classificação é nossa avaliação comercial.</p></div></details>
    <p className="text-sm text-slate-600">Cadastro no mês anterior ao início. Divulgação conforme cada evento. Datas móveis aparecem em janelas de referência e precisam de confirmação.</p>
    {modal && eventos && filtros.visao === "anual" && <EventosModal mes={modal.mes} titulo={etapas.find((e) => e.id === modal.etapa)?.titulo ?? "Eventos"} itens={meses[modal.mes - 1][modal.etapa]} regioes={filtros.regioes} onFechar={() => setModal(null)} />}
  </div>;
}

export default function CalendarioPage() {
  return <AccessGuard permissions={["podeVisualizarTarefasMidia"]}><CalendarioConteudo /></AccessGuard>;
}
