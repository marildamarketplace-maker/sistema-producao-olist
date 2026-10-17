"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Megaphone, PackagePlus } from "lucide-react";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { carregarCalendario } from "./actions";
import {
  CATEGORIAS, MESES, PRODUTOS, REGIOES, escreverFiltros, formatarPeriodo, hojeBrasil,
  lerFiltros, montarPlanejamento, type Evento, type Filtros, type Ocorrencia,
} from "@/lib/calendario-comercial/planejamento";

const controle = "min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500";

function ItemEvento({ ocorrencia, regioes }: { ocorrencia: Ocorrencia; regioes: Filtros["regioes"] }) {
  const { evento } = ocorrencia;
  const destaques = evento.destaques?.filter((d) => regioes.includes(d.regiao));
  return <li className="min-w-0 rounded-md border border-slate-200 bg-white p-3 text-sm">
    <p className="font-medium text-slate-900">{evento.nome}</p>
    <p className="mt-1 text-xs text-slate-600">{formatarPeriodo(ocorrencia)} · {evento.local ?? evento.regioes.join(", ")}</p>
    {ocorrencia.referencia && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">Confirmar programação da edição · período de referência</p>}
    <p className="mt-2 text-xs font-medium text-slate-700">{evento.produtos.join(" · ")}</p>
    <p className="mt-1 text-sm text-slate-600">{evento.estampas}</p>
    <details className="mt-2">
      <summary className="flex min-h-11 cursor-pointer items-center rounded-md text-sm font-medium text-slate-700 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500">Recomendações e fontes<span className="sr-only"> de {evento.nome}</span></summary>
      <div className="space-y-2 pt-2 text-xs text-slate-600">
        <p>{evento.recomendacao}</p>
        {destaques?.map((d) => <p key={d.regiao}><strong>{d.regiao}:</strong> {d.texto}</p>)}
        <p>Categoria: {evento.categoria}. Divulgação sugerida: {evento.divulgacao === "ambos" ? "mês anterior e durante o período" : evento.divulgacao === "anterior" ? "mês anterior" : "durante o período"}.</p>
        <ul>{evento.fontes.map((f) => <li key={f.url}><a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center break-words underline underline-offset-4 focus-visible:outline focus-visible:outline-2">{f.titulo}<span className="sr-only"> (abre em nova aba)</span></a></li>)}</ul>
        <p>Fontes contextualizam a celebração; sugestões de produtos, estampas e antecedência são recomendações comerciais.</p>
      </div>
    </details>
  </li>;
}

function CalendarioConteudo() {
  const { session, usuario } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [hoje] = useState(() => hojeBrasil());
  const filtros = lerFiltros(new URLSearchParams(searchParams.toString()), hoje.ano);
  const [catalogo, setCatalogo] = useState<{ token: string; eventos: Evento[] } | null>(null);
  const [erro, setErro] = useState("");
  const [tentativa, setTentativa] = useState(0);
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
  const meses = useMemo(() => montarPlanejamento(eventos ?? [], lerFiltros(new URLSearchParams(consulta), hoje.ano)), [eventos, consulta, hoje.ano]);
  const possuiResultados = meses.some((m) => m.cadastrar.length || m.divulgar.length || m.acontecendo.length);

  function atualizar(alteracoes: Partial<Filtros>) {
    router.replace(`${pathname}?${escreverFiltros({ ...filtros, ...alteracoes })}`, { scroll: false });
  }
  function irMes(mes: number) {
    const elemento = document.getElementById(`mes-${mes}`);
    elemento?.scrollIntoView({ block: "start" });
    elemento?.focus({ preventScroll: true });
  }
  function irHoje() {
    if (filtros.ano !== hoje.ano) {
      router.replace(`${pathname}?${escreverFiltros({ ...filtros, ano: hoje.ano })}#mes-${hoje.mes}`, { scroll: true });
    } else irMes(hoje.mes);
  }

  return <div className="min-w-0 space-y-6">
    <PageHeader title="Calendário Comercial" description="Planeje o cadastro de produtos no mês anterior e o reforço de divulgação para cada celebração." />
    <section aria-label="Filtros do calendário" className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium text-slate-700">Ano<select value={filtros.ano} onChange={(e) => atualizar({ ano: Number(e.target.value) })} className={`${controle} ml-2`}>
          {[hoje.ano - 1, hoje.ano, hoje.ano + 1, hoje.ano + 2].map((ano) => <option key={ano}>{ano}</option>)}
        </select></label>
        <button type="button" onClick={irHoje} className={`${controle} font-medium hover:bg-slate-50`}>Ir para este mês</button>
      </div>
      <fieldset className="mt-4"><legend className="text-sm font-medium text-slate-700">Abrangência</legend>
        <div className="mt-2 flex flex-wrap gap-2">{REGIOES.map((regiao) => <label key={regiao} className={`${controle} flex cursor-pointer items-center gap-2`}>
          <input type="checkbox" checked={filtros.regioes.includes(regiao)} disabled={regiao === "Nacional"} onChange={(e) => atualizar({ regioes: e.target.checked ? [...filtros.regioes, regiao] : filtros.regioes.filter((r) => r !== regiao) })} className="h-4 w-4 accent-slate-900" />{regiao}
        </label>)}</div>
        <p className="mt-2 text-xs text-slate-500">Os eventos nacionais acompanham as regiões selecionadas. Eventos locais mostram cidade ou estado.</p>
      </fieldset>
      <details className="mt-4 rounded-md border border-slate-200 p-3" open={Boolean(filtros.produto || filtros.categoria || filtros.busca) || undefined}>
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-slate-700 focus-visible:outline focus-visible:outline-2">Busca e filtros por produto e categoria</summary>
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <form role="search" onSubmit={(e) => { e.preventDefault(); atualizar({ busca: String(new FormData(e.currentTarget).get("busca") ?? "") }); }}><label htmlFor="busca-calendario" className="text-sm text-slate-700">Buscar evento</label><div className="mt-1 flex gap-2"><input id="busca-calendario" key={filtros.busca} name="busca" type="search" maxLength={120} defaultValue={filtros.busca} placeholder="Nome ou local" className="input min-h-11 min-w-0" /><button type="submit" className={controle}>Buscar</button></div></form>
          <label className="text-sm text-slate-700">Produto<select value={filtros.produto} onChange={(e) => atualizar({ produto: e.target.value as Filtros["produto"] })} className={`${controle} mt-1 w-full`}><option value="">Todos os produtos</option>{PRODUTOS.map((p) => <option key={p}>{p}</option>)}</select></label>
          <label className="text-sm text-slate-700">Categoria<select value={filtros.categoria} onChange={(e) => atualizar({ categoria: e.target.value as Filtros["categoria"] })} className={`${controle} mt-1 w-full`}><option value="">Todas as categorias</option>{CATEGORIAS.map((c) => <option key={c}>{c}</option>)}</select></label>
        </div>
      </details>
      <button type="button" onClick={() => atualizar({ regioes: ["Nacional"], produto: "", categoria: "", busca: "" })} className="mt-2 min-h-11 rounded-md px-2 text-sm text-slate-600 underline focus-visible:outline focus-visible:outline-2">Limpar filtros</button>
    </section>
    <p className="text-sm text-slate-600">Referência comercial, sem controle de conclusão. Cadastro no mês anterior ao início; divulgação conforme a sugestão de cada evento. Confirme a programação local antes de produzir.</p>
    {erro ? <div role="alert" className="rounded-lg border border-red-200 bg-white p-5 text-sm text-red-700"><p>{erro}</p><button type="button" onClick={() => { setCatalogo(null); setTentativa((v) => v + 1); }} className={`${controle} mt-3`}>Tentar novamente</button></div>
      : !eventos ? <p role="status" className="p-5 text-sm text-slate-600">Carregando calendário...</p>
      : <>
        <nav aria-label="Ir para o mês" className="flex flex-wrap gap-2">{MESES.map((mes, i) => <button key={mes} type="button" onClick={() => irMes(i + 1)} className={`${controle} hover:bg-slate-50`}>{mes.slice(0, 3)}</button>)}</nav>
        <p role="status" className="text-sm text-slate-600">{possuiResultados ? `${filtros.ano} · ${new Set(meses.flatMap((m) => [...m.cadastrar, ...m.divulgar, ...m.acontecendo].map((o) => `${o.evento.id}-${o.inicio}`))).size} ocorrências no planejamento.` : "Nenhum evento encontrado. Ajuste a busca ou limpe os filtros."}</p>
        <div className="grid items-start gap-6 xl:grid-cols-2">{meses.map((mes) => <section id={`mes-${mes.mes}`} key={mes.mes} tabIndex={-1} aria-labelledby={`titulo-${mes.mes}`} className={`min-w-0 scroll-mt-4 rounded-lg border bg-white p-4 outline-offset-4 sm:p-5 ${filtros.ano === hoje.ano && mes.mes === hoje.mes ? "border-slate-500 ring-2 ring-slate-300" : "border-slate-200"}`}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2"><h2 id={`titulo-${mes.mes}`} className="text-lg font-semibold text-slate-900">{MESES[mes.mes - 1]} <span className="text-sm font-normal text-slate-500">{filtros.ano}</span></h2>{filtros.ano === hoje.ano && mes.mes === hoje.mes && <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">Mês atual</span>}</div>
          <div className="space-y-5">{[
            { titulo: "Cadastrar produtos", itens: mes.cadastrar, vazio: "Nenhum cadastro previsto para o próximo mês.", Icone: PackagePlus },
            { titulo: "Reforçar divulgação", itens: mes.divulgar, vazio: "Nenhum reforço de divulgação sugerido.", Icone: Megaphone },
            { titulo: "Acontecendo neste mês", itens: mes.acontecendo, vazio: "Nenhum evento ou temporada neste mês.", Icone: CalendarDays },
          ].map(({ titulo, itens, vazio, Icone }) => <div key={titulo}>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"><Icone className="h-4 w-4 shrink-0" aria-hidden="true" />{titulo}<span className="text-xs font-normal text-slate-500">({itens.length})</span></h3>
            {itens.length ? <ul className="space-y-2">{itens.map((o) => <ItemEvento key={`${o.evento.id}-${o.inicio}`} ocorrencia={o} regioes={filtros.regioes} />)}</ul> : <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-500">{vazio}</p>}
          </div>)}</div>
        </section>)}</div>
      </>}
  </div>;
}

export default function CalendarioPage() {
  return <AccessGuard permissions={["podeVisualizarTarefasMidia"]}><CalendarioConteudo /></AccessGuard>;
}
