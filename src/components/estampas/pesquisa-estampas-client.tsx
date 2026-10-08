"use client";

import { CRITERIOS_FLEXIVEIS_ESTAMPAS } from "@/domain/preferencias-pesquisa-estampas";
import type { CorrespondenciaEstampa } from "@/domain/consulta-profissional-estampas";
import { extrairReferenciaCodigo } from "@/domain/consulta-profissional-estampas";

import { FILTROS_DESIGN_PESQUISA } from "@/domain/pesquisa-estampas-design";
import type { FacetasPesquisaEstampas } from "@/repositories/pesquisa-estampas-repository";
import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Search,
  Share2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import {
  CONTEUDOS_IMAGEM_ESTAMPA,
  ROTULOS_CONTEUDO_IMAGEM_ESTAMPA,
  ROTULOS_SUPORTE_APLICACAO_ESTAMPA,
  ROTULOS_TIPO_IMAGEM_ESTAMPA,
  SUPORTES_APLICACAO_ESTAMPA,
  TIPOS_IMAGEM_ESTAMPA,
} from "@/domain/estampa-apresentacao";
import type {
  EstampaPesquisaCatalogo,
  ResultadoPesquisaEstampasCatalogo,
} from "@/services/pesquisarEstampasCatalogoService";
import {
  FILTROS_VAZIOS_PESQUISA_ESTAMPAS,
  copiarFiltrosPesquisaEstampas,
  criarQueryPesquisaEstampas,
  lerEstadoUrlPesquisaEstampas,
  temFiltroPesquisaEstampas,
  type FiltrosPesquisaEstampasUrl,
  type OrdenacaoUrlPesquisaEstampas,
} from "@/services/filtrosPesquisaEstampas";

type Facetas = FacetasPesquisaEstampas;

type Filtros = FiltrosPesquisaEstampasUrl;
const FILTROS_INICIAIS = FILTROS_VAZIOS_PESQUISA_ESTAMPAS;

const FACETAS_VAZIAS: Facetas = {
  estilos: [], distribuicoes: [], orientacoes: [], densidades: [], linguagensVisuais: [], aplicacoesSugeridas: [],
  temas: [],
  cores: [],
  elementosVisuais: [],
  categorias: [],
  ocasioes: [],
  publicosSugeridos: [],
  contextosUso: [],
  afinidadesVisuais: [],
  padroesTexteis: [],
  tiposImagem: [...TIPOS_IMAGEM_ESTAMPA],
  conteudosImagem: [...CONTEUDOS_IMAGEM_ESTAMPA],
  suportesAplicacao: [...SUPORTES_APLICACAO_ESTAMPA],
};

const statusClasses: Record<Filtros["status"], string> = {
  "": "bg-slate-100 text-slate-700",
  TODOS: "bg-slate-100 text-slate-700",
  PENDING: "bg-amber-50 text-amber-800",
  PROCESSING: "bg-blue-50 text-blue-700",
  COMPLETED: "bg-emerald-50 text-emerald-700",
  FAILED: "bg-red-50 text-red-700",
};

export function PesquisaEstampasClient() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const parametrosUrl = useSearchParams();
  const queryAtual = parametrosUrl.toString();
  const estadoInicial = lerEstadoUrlPesquisaEstampas(parametrosUrl);
  const [form, setForm] = useState<Filtros>(() =>
    copiarFiltrosPesquisaEstampas(estadoInicial.filtros),
  );
  const [filtros, setFiltros] = useState<Filtros | null>(null);
  const [facetas, setFacetas] = useState<Facetas>(FACETAS_VAZIAS);
  const [carregandoFacetas, setCarregandoFacetas] = useState(false);
  const [erroFacetas, setErroFacetas] = useState<string | null>(null);
  const [tentativaFacetas, setTentativaFacetas] = useState(0);
  const [resultado, setResultado] = useState<ResultadoPesquisaEstampasCatalogo | null>(null);
  const [pagina, setPagina] = useState(estadoInicial.pagina);
  const [porPagina, setPorPagina] = useState(estadoInicial.porPagina);
  const [ordenacao, setOrdenacao] = useState<OrdenacaoUrlPesquisaEstampas>(
    estadoInicial.ordenacao,
  );
  const [selecionada, setSelecionada] = useState<EstampaPesquisaCatalogo | null>(null);
  const [imagemAmpliada, setImagemAmpliada] = useState<EstampaPesquisaCatalogo | null>(null);
  const [filtrosAvancadosAbertos, setFiltrosAvancadosAbertos] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [linkCopiado, setLinkCopiado] = useState(false);
  const filtrosAntesDoModal = useRef<Filtros | null>(null);
  const timeoutLinkCopiado = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buscar = useCallback(async (signal: AbortSignal) => {
    if (!session?.access_token || !filtros) return;
    setCarregando(true);
    setErro(null);
    try {
      const params = criarQueryPesquisaEstampas(filtros, pagina, ordenacao, porPagina);
      const response = await fetch(`/api/estampas/pesquisa?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
        signal,
      });
      const dados = await response.json();
      if (!response.ok) throw new Error(dados.error ?? "Erro ao pesquisar estampas.");
      if (!signal.aborted) setResultado(dados);
    } catch (cause) {
      if (signal.aborted) return;
      setErro(cause instanceof Error ? cause.message : "Erro ao pesquisar estampas.");
    } finally {
      if (!signal.aborted) setCarregando(false);
    }
  }, [filtros, ordenacao, pagina, porPagina, session?.access_token]);

  useEffect(() => {
    if (!session?.access_token) return;
    const controller = new AbortController();
    setCarregandoFacetas(true);
    setErroFacetas(null);
    const params = new URLSearchParams({ facetas: "1", status: form.status || "COMPLETED" });
    void (async () => {
      try {
        const response = await fetch(`/api/estampas/pesquisa?${params}`, {
          headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store", signal: controller.signal,
        });
        const dados = await response.json();
        if (!response.ok) throw new Error(dados.error ?? "Erro ao carregar filtros.");
        if (!controller.signal.aborted) setFacetas(dados.facetas);
      } catch (cause) {
        if (!controller.signal.aborted) setErroFacetas(cause instanceof Error ? cause.message : "Erro ao carregar filtros.");
      } finally {
        if (!controller.signal.aborted) setCarregandoFacetas(false);
      }
    })();
    return () => controller.abort();
  }, [form.status, session?.access_token, tentativaFacetas]);

  useEffect(() => {
    const estado = lerEstadoUrlPesquisaEstampas(new URLSearchParams(queryAtual));
    const filtrosUrl = copiarFiltrosPesquisaEstampas(estado.filtros);
    setForm(filtrosUrl);
    setPagina(estado.pagina);
    setPorPagina(estado.porPagina);
    setOrdenacao(estado.ordenacao);
    setSelecionada(null);
    setImagemAmpliada(null);
    setResultado(null);
    setErro(null);
    setLinkCopiado(false);
    if (timeoutLinkCopiado.current) clearTimeout(timeoutLinkCopiado.current);
    if (temFiltroPesquisaEstampas(filtrosUrl)) {
      setFiltros(filtrosUrl);
    } else {
      setFiltros(null);
      setCarregando(false);
    }
  }, [queryAtual]);

  useEffect(() => {
    if (!filtros) return;
    const controller = new AbortController();
    void buscar(controller.signal);
    return () => controller.abort();
  }, [buscar, filtros]);

  useEffect(() => {
    if (!filtrosAvancadosAbertos) return;
    function fecharComEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (filtrosAntesDoModal.current) setForm(filtrosAntesDoModal.current);
        filtrosAntesDoModal.current = null;
        setFiltrosAvancadosAbertos(false);
      }
    }
    window.addEventListener("keydown", fecharComEscape);
    return () => window.removeEventListener("keydown", fecharComEscape);
  }, [filtrosAvancadosAbertos]);

  useEffect(() => () => {
    if (timeoutLinkCopiado.current) clearTimeout(timeoutLinkCopiado.current);
  }, []);

  function pesquisar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    aplicarPesquisa();
  }

  function aplicarPesquisa() {
    if (!temFiltroPesquisaEstampas(form)) {
      setFiltros(null);
      setResultado(null);
      setCarregando(false);
      setErro("Informe ao menos um filtro antes de pesquisar.");
      return;
    }
    const proximaOrdenacao = (form.consulta.trim() || temPreferenciasAtivas(form)) ? "RELEVANCIA" : "RECENTES";
    setErro(null);
    filtrosAntesDoModal.current = null;
    setFiltrosAvancadosAbertos(false);
    atualizarUrl(form, 1, proximaOrdenacao);
  }

  function abrirFiltrosAvancados() {
    filtrosAntesDoModal.current = copiarFiltrosPesquisaEstampas(form);
    setFiltrosAvancadosAbertos(true);

  }

  function cancelarFiltrosAvancados() {
    if (filtrosAntesDoModal.current) {
      setForm(filtrosAntesDoModal.current);
    }
    filtrosAntesDoModal.current = null;
    setFiltrosAvancadosAbertos(false);
  }

  function limpar() {
    setForm(copiarFiltrosPesquisaEstampas(FILTROS_INICIAIS));
    setFiltros(null);
    setResultado(null);
    setErro(null);
    setCarregando(false);
    setPagina(1);
    setPorPagina(24);
    setOrdenacao("RECENTES");
    setFiltrosAvancadosAbertos(false);
    if (queryAtual) router.push(pathname, { scroll: false });
  }

  function atualizarUrl(
    proximosFiltros: Filtros,
    proximaPagina: number,
    proximaOrdenacao: OrdenacaoUrlPesquisaEstampas,
    proximoPorPagina = porPagina,
  ) {
    const query = criarQueryPesquisaEstampas(
      proximosFiltros,
      proximaPagina,
      proximaOrdenacao,
      proximoPorPagina,
    ).toString();
    if (query === queryAtual) {
      setPagina(proximaPagina);
      setPorPagina(proximoPorPagina);
      setOrdenacao(proximaOrdenacao);
      setResultado(null);
      setFiltros(copiarFiltrosPesquisaEstampas(proximosFiltros));
      return;
    }
    router.push(`${pathname}?${query}`, { scroll: false });
  }

  async function compartilharResultado() {
    if (!filtros) return;
    try {
      const query = criarQueryPesquisaEstampas({ ...filtros, status: filtros.status || "COMPLETED" }, pagina, ordenacao, porPagina);
      const link = new URL(`${pathname}?${query}`, window.location.origin);
      await navigator.clipboard.writeText(link.toString());
      setLinkCopiado(true);
      if (timeoutLinkCopiado.current) clearTimeout(timeoutLinkCopiado.current);
      timeoutLinkCopiado.current = setTimeout(() => setLinkCopiado(false), 2000);
    } catch {
      setErro("Não foi possível copiar o link desta pesquisa.");
    }
  }

  const totalFiltrosAvancados = contarFiltrosAvancados(form);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pesquisa de estampas"
        description="Encontre estampas por motivos, cores, estilo e composição. Combine critérios e compartilhe a pesquisa por link."
      />

      <form onSubmit={pesquisar} className="space-y-5 rounded-lg border border-slate-200 bg-white p-5">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Pesquisa geral</span>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-400" />
            <input
              value={form.consulta}
              onChange={(event) => setForm({ ...form, consulta: event.target.value })}
              placeholder='Ex.: cereja amarela · "animal print" · floral -texto'
              maxLength={200}
              className="w-full rounded-md border border-slate-300 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />
          </div>
        </label>

        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,280px)_1fr]">
          <Campo label="Correspondência mínima">
            <SelectCorrespondencia value={form.correspondenciaMinima} disabled={!temPreferenciasAtivas(form)} onChange={(correspondenciaMinima) => setForm({ ...form, correspondenciaMinima })} />
          </Campo>
          <p className="text-xs leading-relaxed text-slate-600">A busca ampliada inclui resultados parciais. Em “cereja amarela”, os dois termos atendidos representam 100%; só cereja ou só amarela representa 50%. Na ordenação por correspondência, os mais completos vêm primeiro.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Campo label="Código">
            <input value={form.codigo} onChange={(event) => setForm({ ...form, codigo: event.target.value })} placeholder="6844" className={inputClass} />
          </Campo>
          <Campo label="Variante">
            <input value={form.variante} onChange={(event) => setForm({ ...form, variante: event.target.value })} placeholder="A" className={inputClass} />
          </Campo>
          <Campo label="Status">
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Filtros["status"] })} className={inputClass}>
              <option value="">Concluídas (padrão)</option>
              {Object.entries(rotulosStatus).map(([status, rotulo]) => <option key={status} value={status}>{rotulo}</option>)}
            </select>
          </Campo>
          <Campo label="Tipo de imagem">
            <SelectRotulado
              value={form.tipoImagem}
              onChange={(tipoImagem) => setForm({ ...form, tipoImagem: tipoImagem as Filtros["tipoImagem"] })}
              options={facetas.tiposImagem}
              labels={ROTULOS_TIPO_IMAGEM_ESTAMPA}
              placeholder="Todos os tipos"
            />
          </Campo>
          <Campo label="Padrão têxtil">
            <Select value={form.padraoTextil} onChange={(padraoTextil) => setForm({ ...form, padraoTextil })} options={facetas.padroesTexteis} placeholder="Todos os padrões" />
          </Campo>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Campo label="Categoria do motivo">
            <Select value={form.categoria} onChange={(categoria) => setForm({ ...form, categoria })} options={facetas.categorias} placeholder="Todas as categorias" />
          </Campo>
          {FILTROS_DESIGN_PESQUISA.filter(({ campo }) => ["estilo", "distribuicao", "linguagemVisual"].includes(campo)).map(({ campo, faceta, rotulo }) => (
            <Campo key={campo} label={rotulo}>
              <Select value={form[campo]} onChange={(valor) => setForm({ ...form, [campo]: valor })} options={facetas[faceta]} placeholder="Todas as opções" />
            </Campo>
          ))}
        </div>
        <PreferenciasPesquisa filtros={form} onChange={setForm} />
        <p className="text-xs text-slate-500">Use aspas para uma frase e -termo para excluir. Prefixos e variações de cores são aceitos: cereja encontra cerejas; amarela também encontra amarelo. Escolha abaixo quais critérios são obrigatórios ou preferências.</p>
        {carregandoFacetas && <p role="status" className="text-xs text-slate-500">Carregando opções de filtros...</p>}
        {erroFacetas && <p role="alert" className="text-sm text-red-700">{erroFacetas} <button type="button" onClick={() => setTentativaFacetas((valor) => valor + 1)} className="underline">Tentar novamente</button></p>}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={abrirFiltrosAvancados} className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
            <SlidersHorizontal className="h-4 w-4" /> Filtros avançados
            {totalFiltrosAvancados > 0 && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs text-white">{totalFiltrosAvancados}</span>}
          </button>
          <div className="flex flex-wrap gap-3">
          <button type="button" onClick={limpar} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Limpar filtros</button>
          <button type="submit" className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"><Search className="h-4 w-4" /> Pesquisar</button>
          </div>
        </div>
      </form>

      {filtrosAvancadosAbertos && (
        <FiltrosAvancadosModal
          filtros={form}
          facetas={facetas}
          onChange={setForm}
          onApply={aplicarPesquisa}
          onClear={limpar}
          onClose={cancelarFiltrosAvancados}
        />
      )}

      {erro && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      {filtros && <div className="flex flex-wrap gap-2" aria-label="Filtros aplicados">
        {chipsFiltros(filtros).map(({ campo, valor, rotulo }) => (
          <button key={`${campo}:${valor}`} type="button" disabled={carregando} onClick={() => {
            const proximos = copiarFiltrosPesquisaEstampas(filtros);
            if (campo === "cores") proximos.cores = proximos.cores.filter((cor) => cor !== valor);
            else if (campo === "status") proximos.status = "";
            else Object.assign(proximos, { [campo]: "" });
            if (temFiltroPesquisaEstampas(proximos)) atualizarUrl(proximos, 1, ordenacao);
            else limpar();
          }} className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 disabled:opacity-50" aria-label={`Remover ${rotulo}: ${valor}`}>
            {rotulo}: {campo === "status" ? rotulosStatus[valor] : valor} · {filtros.preferencias.includes(campo) && !(campo === "consulta" && extrairReferenciaCodigo(filtros.consulta)) ? "Preferência" : "Obrigatório"}<X className="h-3 w-3" />
          </button>
        ))}
      </div>}
      {carregando && <p role="status" className="text-sm text-slate-600">Pesquisando estampas...</p>}

      {resultado?.cobertura && filtros && (
        <section className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4" aria-label="Como a consulta foi atendida">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Preferências atendidas: {resultado.cobertura.termos.join(" + ")}</h2>
              <p className="mt-1 text-sm text-slate-700">{resultado.cobertura.completas} resultado(s) com 100% · {resultado.cobertura.parciais} com correspondência parcial</p>
            </div>
            <label className="text-sm text-slate-700">Mostrar resultados que atendam
              <div className="mt-1"><SelectCorrespondencia value={filtros.correspondenciaMinima} disabled={carregando} onChange={(correspondenciaMinima) => atualizarUrl({ ...filtros, correspondenciaMinima }, 1, ordenacao)} /></div>
            </label>
          </div>
          <p className="text-xs leading-relaxed text-slate-600">O percentual considera apenas preferências: cada filtro selecionado vale um critério; na pesquisa geral, cada termo ou frase vale um critério. Um grupo de cores vale um critério, seguindo “todas” ou “qualquer”. Não é confiança da IA. Critérios obrigatórios, códigos e exclusões sempre são respeitados. Mesmo em 100%, termos podem descrever elementos diferentes da imagem.</p>
          {resultado.cobertura.excluidos.length > 0 && <p className="text-xs text-slate-600">Excluídos: {resultado.cobertura.excluidos.join(" · ")}</p>}
          {ordenacao !== "RELEVANCIA" && <p className="text-xs text-slate-600">A lista segue a ordenação escolhida. Selecione “Correspondência e relevância” para priorizar os maiores percentuais.</p>}
        </section>
      )}

      {resultado && <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{carregando ? "Pesquisando..." : `${resultado.total} resultado(s) encontrado(s)`}</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Por página
            <select value={porPagina} disabled={carregando} onChange={(event) => filtros && atualizarUrl(filtros, 1, ordenacao, Number(event.target.value))} className={inputClass}>
              {[...new Set([12, 24, 48, 60, porPagina])].sort((a, b) => a - b).map((valor) => <option key={valor} value={valor}>{valor}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Ordenar por
            <select
              value={ordenacao}
              onChange={(event) => {
                if (filtros) {
                  atualizarUrl(
                    filtros,
                    1,
                    event.target.value as OrdenacaoUrlPesquisaEstampas,
                  );
                }
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
            >
              <option value="RELEVANCIA">Correspondência e relevância</option>
              <option value="RECENTES">Mais recentes</option>
              <option value="CODIGO_ASC">Código crescente</option>
              <option value="CODIGO_DESC">Código decrescente</option>
            </select>
          </label>
          <button
            type="button"
            onClick={compartilharResultado}
            disabled={carregando}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            {linkCopiado ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
            {linkCopiado ? "Link copiado" : "Compartilhar resultado"}
          </button>
          <span className="sr-only" aria-live="polite">
            {linkCopiado ? "Link da pesquisa copiado para a área de transferência." : ""}
          </span>
        </div>
      </div>}

      {!filtros && !resultado && !carregando && (
        <section className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          Informe ao menos um filtro e clique em Pesquisar para carregar as estampas.
        </section>
      )}

      {!carregando && resultado?.estampas.length === 0 && (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          <p>Nenhuma estampa encontrada com os filtros informados.</p>
          {filtros && resultado?.cobertura && filtros.correspondenciaMinima > 1 && <button type="button" onClick={() => atualizarUrl({ ...filtros, correspondenciaMinima: 1 }, 1, "RELEVANCIA")} className="rounded-md border border-slate-300 px-4 py-2 font-medium text-slate-700">Ampliar para pelo menos uma preferência</button>}
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {resultado?.estampas.map((estampa) => (
          <EstampaCard
            key={estampa.id}
            estampa={estampa}
            onAmpliarImagem={() => setImagemAmpliada(estampa)}
            onDetalhes={() => setSelecionada(estampa)}
          />
        ))}
      </section>

      {(resultado?.totalPaginas ?? 0) > 1 && (
        <nav className="flex items-center justify-center gap-3" aria-label="Paginação">
          <button type="button" onClick={() => filtros && atualizarUrl(filtros, Math.max(1, pagina - 1), ordenacao)} disabled={pagina <= 1 || carregando} className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50"><ChevronLeft className="h-4 w-4" /> Anterior</button>
          <span className="text-sm text-slate-600">Página {resultado?.pagina ?? pagina} de {resultado?.totalPaginas ?? 1}</span>
          <button type="button" onClick={() => filtros && atualizarUrl(filtros, Math.min(resultado?.totalPaginas ?? pagina, pagina + 1), ordenacao)} disabled={pagina >= (resultado?.totalPaginas ?? 1) || carregando} className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50">Próxima <ChevronRight className="h-4 w-4" /></button>
        </nav>
      )}

      {selecionada && <DetalhesEstampa estampa={selecionada} onClose={() => setSelecionada(null)} />}
      {imagemAmpliada && <ImagemAmpliadaModal estampa={imagemAmpliada} onClose={() => setImagemAmpliada(null)} />}
    </div>
  );
}

function FiltrosAvancadosModal({
  filtros,
  facetas,
  onChange,
  onApply,
  onClear,
  onClose,
}: {
  filtros: Filtros;
  facetas: Facetas;
  onChange: (filtros: Filtros) => void;
  onApply: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const modal = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focaveis = () => Array.from(modal.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]',
    ) ?? []);
    focaveis()[0]?.focus();
    function manterFoco(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const elementos = focaveis();
      const primeiro = elementos[0];
      const ultimo = elementos.at(-1);
      if (event.shiftKey && document.activeElement === primeiro) {
        event.preventDefault();
        ultimo?.focus();
      } else if (!event.shiftKey && document.activeElement === ultimo) {
        event.preventDefault();
        primeiro?.focus();
      }
    }
    document.addEventListener("keydown", manterFoco);
    return () => {
      document.removeEventListener("keydown", manterFoco);
      document.body.style.overflow = overflow;
      anterior?.focus();
    };
  }, []);
  return (
    <div ref={modal} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="titulo-filtros-avancados" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white shadow-xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5">
          <div>
            <h2 id="titulo-filtros-avancados" className="text-xl font-semibold text-slate-900">Filtros avançados</h2>
            <p className="mt-1 text-sm text-slate-500">Combine os critérios disponíveis para refinar a pesquisa.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar filtros avançados" className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </header>

        <div className="space-y-5 p-6">
          <Campo label="Pesquisa geral">
            <input value={filtros.consulta} onChange={(event) => onChange({ ...filtros, consulta: event.target.value })} placeholder='Ex.: cereja amarela · "animal print" · floral -texto' maxLength={200} className={inputClass} />
          </Campo>

          <Campo label="Correspondência mínima da pesquisa geral">
            <SelectCorrespondencia value={filtros.correspondenciaMinima} disabled={!temPreferenciasAtivas(filtros)} onChange={(correspondenciaMinima) => onChange({ ...filtros, correspondenciaMinima })} />
          </Campo>
          <h3 className="text-sm font-semibold text-slate-900">Identificação e apresentação</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Campo label="Código">
              <input value={filtros.codigo} onChange={(event) => onChange({ ...filtros, codigo: event.target.value })} placeholder="6844" className={inputClass} />
            </Campo>
            <Campo label="Variante">
              <input value={filtros.variante} onChange={(event) => onChange({ ...filtros, variante: event.target.value })} placeholder="A" className={inputClass} />
            </Campo>
            <Campo label="Status">
              <select value={filtros.status} onChange={(event) => onChange({ ...filtros, status: event.target.value as Filtros["status"] })} className={inputClass}>
                <option value="">Concluídas (padrão)</option>
                {Object.entries(rotulosStatus).map(([status, rotulo]) => <option key={status} value={status}>{rotulo}</option>)}
              </select>
            </Campo>
            <Campo label="Tipo de imagem">
              <SelectRotulado
                value={filtros.tipoImagem}
                onChange={(tipoImagem) => onChange({ ...filtros, tipoImagem: tipoImagem as Filtros["tipoImagem"] })}
                options={facetas.tiposImagem}
                labels={ROTULOS_TIPO_IMAGEM_ESTAMPA}
                placeholder="Todos os tipos"
              />
            </Campo>
            <Campo label="Suporte da aplicação">
              <SelectRotulado
                value={filtros.suporteAplicacao}
                onChange={(suporteAplicacao) => onChange({ ...filtros, suporteAplicacao: suporteAplicacao as Filtros["suporteAplicacao"] })}
                options={facetas.suportesAplicacao}
                labels={ROTULOS_SUPORTE_APLICACAO_ESTAMPA}
                placeholder="Todos os suportes"
              />
            </Campo>
            <Campo label="Conteúdo presente">
              <SelectRotulado
                value={filtros.conteudoImagem}
                onChange={(conteudoImagem) => onChange({ ...filtros, conteudoImagem: conteudoImagem as Filtros["conteudoImagem"] })}
                options={facetas.conteudosImagem}
                labels={ROTULOS_CONTEUDO_IMAGEM_ESTAMPA}
                placeholder="Todos os conteúdos"
              />
            </Campo>
          </div>
          <h3 className="border-t border-slate-200 pt-4 text-sm font-semibold text-slate-900">Motivos e contexto</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Campo label="Tema">
              <Select value={filtros.tema} onChange={(tema) => onChange({ ...filtros, tema })} options={facetas.temas} placeholder="Todos os temas" />
            </Campo>
            <Campo label="Palavra-chave">
              <input value={filtros.palavraChave} onChange={(event) => onChange({ ...filtros, palavraChave: event.target.value })} placeholder="papai noel" className={inputClass} />
            </Campo>
            <Campo label="Elemento visual">
              <Select value={filtros.elementoVisual} onChange={(elementoVisual) => onChange({ ...filtros, elementoVisual })} options={facetas.elementosVisuais} placeholder="Todos os elementos" />
            </Campo>
            <Campo label="Categoria">
              <Select value={filtros.categoria} onChange={(categoria) => onChange({ ...filtros, categoria })} options={facetas.categorias} placeholder="Todas as categorias" />
            </Campo>
            <Campo label="Ocasião">
              <Select value={filtros.ocasiao} onChange={(ocasiao) => onChange({ ...filtros, ocasiao })} options={facetas.ocasioes} placeholder="Todas as ocasiões" />
            </Campo>
            <Campo label="Público sugerido">
              <Select value={filtros.publicoSugerido} onChange={(publicoSugerido) => onChange({ ...filtros, publicoSugerido })} options={facetas.publicosSugeridos} placeholder="Todos os públicos" />
            </Campo>
            <Campo label="Contexto de uso">
              <Select value={filtros.contextoUso} onChange={(contextoUso) => onChange({ ...filtros, contextoUso })} options={facetas.contextosUso} placeholder="Todos os contextos" />
            </Campo>
            <Campo label="Afinidade visual">
              <Select value={filtros.afinidadeVisual} onChange={(afinidadeVisual) => onChange({ ...filtros, afinidadeVisual })} options={facetas.afinidadesVisuais} placeholder="Todas as afinidades" />
            </Campo>
            <Campo label="Padrão têxtil">
              <Select value={filtros.padraoTextil} onChange={(padraoTextil) => onChange({ ...filtros, padraoTextil })} options={facetas.padroesTexteis} placeholder="Todos os padrões" />
            </Campo>
          </div>
          <h3 className="border-t border-slate-200 pt-4 text-sm font-semibold text-slate-900">Design e composição</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FILTROS_DESIGN_PESQUISA.map(({ campo, faceta, rotulo }) => (
              <Campo key={campo} label={rotulo} hint={campo === "aplicacaoSugerida" ? "Confiança mínima de 70%" : undefined}>
                <Select value={filtros[campo]} onChange={(valor) => onChange({ ...filtros, [campo]: valor })} options={facetas[faceta]} placeholder="Todas as opções" />
              </Campo>
            ))}
          </div>
          <p className="text-xs text-slate-500">Aplicações são sugestões de reaproveitamento. Distribuição corrida não comprova rapport técnico; linguagem vetorial descreve aparência.</p>

          <SeletorCores filtros={filtros} cores={facetas.cores} onChange={onChange} />
          <PreferenciasPesquisa filtros={filtros} onChange={onChange} />

        </div>

        <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-4">
          <button type="button" onClick={onClear} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Limpar todos</button>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Cancelar</button>
            <button type="button" onClick={onApply} className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"><Search className="h-4 w-4" /> Aplicar filtros</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function EstampaCard({
  estampa,
  onAmpliarImagem,
  onDetalhes,
}: {
  estampa: EstampaPesquisaCatalogo;
  onAmpliarImagem: () => void;
  onDetalhes: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      {estampa.correspondencia && <CorrespondenciaPesquisa correspondencia={estampa.correspondencia} />}
      {estampa.previewUrl ? (
        <button
          type="button"
          onClick={onAmpliarImagem}
          aria-label={`Ampliar imagem da estampa ${codigoCompleto(estampa)}`}
          className="group block w-full cursor-zoom-in overflow-hidden bg-slate-100 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-500"
        >
          <Preview estampa={estampa} className="aspect-square w-full transition-transform duration-200 group-hover:scale-[1.02]" />
        </button>
      ) : (
        <Preview estampa={estampa} className="aspect-square w-full" />
      )}
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div><p className="font-semibold text-slate-900">{codigoCompleto(estampa)}</p><h2 className="mt-1 line-clamp-2 text-sm text-slate-700">{estampa.titulo || "Sem título"}</h2></div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${statusClasses[estampa.processingStatus]}`}>{estampa.processingStatus}</span>
        </div>
        <InfoCompacta label="Tema" valores={estampa.tema ? [estampa.tema] : []} />
        <InfoCompacta label="Apresentação" valores={[ROTULOS_TIPO_IMAGEM_ESTAMPA[estampa.tipoImagem]]} />
        <InfoCompacta label="Cores" valores={estampa.cores.slice(0, 4)} />
        <InfoCompacta label="Palavras-chave" valores={estampa.palavrasChave.slice(0, 4)} />
        <InfoCompacta label="Padrão têxtil" valores={estampa.padroesTexteis.slice(0, 3)} />
        <InfoCompacta label="Estilo" valores={estampa.estilo ? [estampa.estilo] : []} />
        <InfoCompacta label="Distribuição" valores={estampa.design.distribuicoes} />
        <InfoCompacta label="Linguagem" valores={estampa.design.linguagensVisuais} />
        <button type="button" onClick={onDetalhes} className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"><Eye className="h-4 w-4" /> Ver detalhes</button>
      </div>
    </article>
  );
}

function ImagemAmpliadaModal({ estampa, onClose }: { estampa: EstampaPesquisaCatalogo; onClose: () => void }) {
  useEffect(() => {
    function fecharComEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", fecharComEscape);
    return () => window.removeEventListener("keydown", fecharComEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Imagem ampliada da estampa ${codigoCompleto(estampa)}`}
      onClick={onClose}
    >
      <section
        className="relative flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-slate-900">{codigoCompleto(estampa)}</h2>
            <p className="truncate text-sm text-slate-500">{estampa.titulo || "Sem título"}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar imagem ampliada" className="shrink-0 rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-100 p-3">
          {/* A URL é dinâmica e vem do catálogo privado autorizado para este usuário. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={estampa.previewUrl ?? ""}
            alt={`Preview ampliado da estampa ${codigoCompleto(estampa)}`}
            className="max-h-[calc(95vh-5rem)] max-w-full object-contain"
          />
        </div>
      </section>
    </div>
  );
}

function DetalhesEstampa({ estampa, onClose }: { estampa: EstampaPesquisaCatalogo; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-label={`Detalhes da estampa ${codigoCompleto(estampa)}`}>
      <section className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="text-xl font-semibold text-slate-900">{codigoCompleto(estampa)}</h2><p className="mt-1 text-sm text-slate-500">{estampa.titulo || "Sem título"}</p></div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        {estampa.correspondencia && <div className="mt-4"><CorrespondenciaPesquisa correspondencia={estampa.correspondencia} /></div>}
        <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,320px)_1fr]">
          <Preview estampa={estampa} className="aspect-square w-full rounded-lg" />
          <dl className="grid content-start gap-4 text-sm sm:grid-cols-2">
            <Detalhe label="Status" valores={[estampa.processingStatus]} />
            <Detalhe label="Tipo de imagem" valores={[ROTULOS_TIPO_IMAGEM_ESTAMPA[estampa.tipoImagem]]} />
            <Detalhe label="Suporte da aplicação" valores={[ROTULOS_SUPORTE_APLICACAO_ESTAMPA[estampa.suporteAplicacao]]} />
            <Detalhe label="Conteúdos presentes" valores={estampa.conteudosImagem.map((conteudo) => ROTULOS_CONTEUDO_IMAGEM_ESTAMPA[conteudo])} />
            <Detalhe label="Confiança da apresentação" valores={estampa.confiancaTipoImagem === null ? [] : [`${Math.round(estampa.confiancaTipoImagem * 100)}%`]} />
            <Detalhe label="Descrição da aplicação" valores={estampa.descricaoAplicacao ? [estampa.descricaoAplicacao] : []} className="sm:col-span-2" />
            <Detalhe label="Tema" valores={estampa.tema ? [estampa.tema] : []} />
            <Detalhe label="Subtemas" valores={estampa.subtemas} />
            <Detalhe label="Estilo" valores={estampa.estilo ? [estampa.estilo] : []} />
            <Detalhe label="Distribuição" valores={estampa.design.distribuicoes} />
            <Detalhe label="Orientação" valores={estampa.design.orientacoes} />
            <Detalhe label="Densidade" valores={estampa.design.densidades} />
            <Detalhe label="Linguagem visual" valores={estampa.design.linguagensVisuais} />
            <Detalhe label="Aplicações sugeridas (≥70%)" valores={estampa.design.aplicacoesSugeridas.map((sugestao) => `${sugestao.termo} · ${Math.round(sugestao.confianca * 100)}% · ${sugestao.evidencias.join("; ")}`)} className="sm:col-span-2" />
            <Detalhe label="Cores" valores={estampa.cores} />
            <Detalhe label="Elementos visuais" valores={estampa.elementosVisuais} />
            <Detalhe label="Categorias" valores={estampa.categorias} />
            <Detalhe label="Ocasiões" valores={estampa.ocasioes} />
            <Detalhe label="Públicos sugeridos pela IA" valores={estampa.publicosSugeridos} />
            <Detalhe label="Contextos de uso sugeridos" valores={estampa.contextosUso} />
            <Detalhe label="Afinidades visuais" valores={estampa.afinidadesVisuais} />
            <Detalhe label="Confiança média da segmentação" valores={estampa.confiancaSegmentacao === null ? [] : [`${Math.round(estampa.confiancaSegmentacao * 100)}%`]} />
            <Detalhe label="Palavras-chave" valores={estampa.palavrasChave} className="sm:col-span-2" />
            <Detalhe label="Padrões têxteis" valores={estampa.padroesTexteis} />
            <Detalhe label="Confiança do padrão têxtil" valores={estampa.confiancaPadraoTextil === null ? [] : [`${Math.round(estampa.confiancaPadraoTextil * 100)}%`]} />
            <Detalhe label="Descrição" valores={estampa.descricao ? [estampa.descricao] : []} className="sm:col-span-2" />
          </dl>
        </div>
        <SegmentacaoDetalhada estampa={estampa} />
      </section>
    </div>
  );
}

function SegmentacaoDetalhada({ estampa }: { estampa: EstampaPesquisaCatalogo }) {
  const grupos = [
    ["Padrões têxteis", estampa.classificacaoTextil.padroesTexteis],
    ["Públicos sugeridos", estampa.segmentacaoBusca.publicosSugeridos],
    ["Contextos de uso", estampa.segmentacaoBusca.contextosUso],
    ["Afinidades visuais", estampa.segmentacaoBusca.afinidadesVisuais],
  ] as const;
  if (grupos.every(([, sugestoes]) => sugestoes.length === 0)) return null;

  return (
    <section className="mt-6 border-t border-slate-200 pt-5">
      <h3 className="text-sm font-semibold text-slate-900">Sugestões da IA para pesquisa</h3>
      <p className="mt-1 text-xs text-slate-500">São afinidades baseadas apenas em sinais visuais, não atributos pessoais de compradores.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {grupos.map(([titulo, sugestoes]) => (
          <div key={titulo} className="rounded-md border border-slate-200 p-3">
            <h4 className="text-xs font-semibold uppercase text-slate-500">{titulo}</h4>
            {sugestoes.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Sem sugestão segura.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {sugestoes.map((sugestao) => (
                  <li key={sugestao.termo} className="text-sm text-slate-700">
                    <p className="font-medium text-slate-900">{sugestao.termo} · {Math.round(sugestao.confianca * 100)}%</p>
                    <p className="mt-1 text-xs text-slate-500">{sugestao.evidencias.join(" · ")}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Preview({ estampa, className }: { estampa: EstampaPesquisaCatalogo; className: string }) {
  return estampa.previewUrl
    // A URL é dinâmica e vem do catálogo privado autorizado para este usuário.
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={estampa.previewUrl} alt={`Preview da estampa ${codigoCompleto(estampa)}`} loading="lazy" className={`${className} bg-slate-100 object-contain`} />
    : <div className={`${className} flex items-center justify-center bg-slate-100 text-sm text-slate-500`}>Sem preview</div>;
}

function Campo({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-sm font-medium text-slate-700">{label}</span>{hint && <span className="ml-2 text-xs text-slate-500">{hint}</span>}<div className="mt-1">{children}</div></label>;
}

function Select({ value, onChange, options, placeholder }: { value: string; onChange: (value: string) => void; options: string[]; placeholder: string }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}><option value="">{placeholder}</option>{[...new Set([...(value ? [value] : []), ...options])].map((option) => <option key={option} value={option}>{option}</option>)}</select>;
}

function SelectRotulado<T extends string>({ value, onChange, options, labels, placeholder }: { value: string; onChange: (value: string) => void; options: readonly T[]; labels: Record<T, string>; placeholder: string }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}><option value="">{placeholder}</option>{[...new Set([...(value && value in labels ? [value as T] : []), ...options])].map((option) => <option key={option} value={option}>{labels[option]}</option>)}</select>;
}

function InfoCompacta({ label, valores }: { label: string; valores: string[] }) {
  if (valores.length === 0) return null;
  return <p className="line-clamp-2 text-xs text-slate-600"><span className="font-semibold text-slate-700">{label}:</span> {valores.join(" · ")}</p>;
}

function Detalhe({ label, valores, className = "" }: { label: string; valores: string[]; className?: string }) {
  return <div className={className}><dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt><dd className="mt-1 text-slate-800">{valores.length > 0 ? valores.join(" · ") : "—"}</dd></div>;
}

function contarFiltrosAvancados(filtros: Filtros) {
  return [
    ...FILTROS_DESIGN_PESQUISA.map(({ campo }) => filtros[campo]),
    filtros.tema,
    filtros.palavraChave,
    filtros.elementoVisual,
    filtros.categoria,
    filtros.ocasiao,
    filtros.publicoSugerido,
    filtros.contextoUso,
    filtros.afinidadeVisual,
    filtros.padraoTextil,
    filtros.tipoImagem,
    filtros.conteudoImagem,
    filtros.suporteAplicacao,
  ].filter((valor) => valor.trim()).length + filtros.cores.length;
}

function codigoCompleto(estampa: Pick<EstampaPesquisaCatalogo, "codigo" | "variante">) {
  return [estampa.codigo, estampa.variante].filter(Boolean).join("-");
}

const inputClass = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200";


const rotulosStatus: Record<string, string> = { COMPLETED: "Concluídas", PENDING: "Pendentes", PROCESSING: "Em processamento", FAILED: "Com falha", TODOS: "Todos os status" };

function chipsFiltros(filtros: Filtros) {
  const rotulos: Partial<Record<keyof Filtros, string>> = {
    consulta: "Busca", codigo: "Código", variante: "Variante", tema: "Tema", palavraChave: "Palavra-chave",
    elementoVisual: "Elemento", categoria: "Categoria", ocasiao: "Ocasião", publicoSugerido: "Público",
    contextoUso: "Contexto", afinidadeVisual: "Afinidade", padraoTextil: "Padrão", tipoImagem: "Imagem",
    suporteAplicacao: "Suporte", conteudoImagem: "Conteúdo", status: "Status",
    ...Object.fromEntries(FILTROS_DESIGN_PESQUISA.map(({ campo, rotulo }) => [campo, rotulo])),
  };
  return Object.entries(rotulos).flatMap(([campo, rotulo]) => {
    const valor = filtros[campo as keyof Filtros];
    return typeof valor === "string" && valor ? [{ campo: campo as keyof Filtros, valor, rotulo }] : [];
  }).concat(filtros.cores.map((valor) => ({ campo: "cores" as const, valor, rotulo: "Cor" })));
}

function SeletorCores({ filtros, cores, onChange }: { filtros: Filtros; cores: string[]; onChange: (filtros: Filtros) => void }) {
  const [busca, setBusca] = useState("");
  const normalizar = (valor: string) => valor.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase();
  const opcoes = [...new Set([...filtros.cores, ...cores])].filter((cor) => normalizar(cor).includes(normalizar(busca)));
  return <fieldset className="space-y-3 rounded-md border border-slate-200 p-4">
    <legend className="px-1 text-sm font-medium text-slate-700">Paleta de cores · {filtros.cores.length}/10 selecionadas</legend>
    <div className="grid gap-3 sm:grid-cols-2">
      <Campo label="Buscar cor"><input value={busca} onChange={(event) => setBusca(event.target.value)} className={inputClass} placeholder="Ex.: azul" /></Campo>
      <Campo label="Combinar cores"><select value={filtros.modoCores} onChange={(event) => onChange({ ...filtros, modoCores: event.target.value as Filtros["modoCores"] })} className={inputClass}>
        <option value="TODAS">Todas as cores selecionadas</option><option value="QUALQUER">Qualquer uma das cores</option>
      </select></Campo>
    </div>
    <div className="grid max-h-52 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
      {opcoes.map((cor) => <label key={cor} className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={filtros.cores.includes(cor)} disabled={!filtros.cores.includes(cor) && filtros.cores.length >= 10} onChange={(event) => onChange({ ...filtros, cores: event.target.checked ? [...filtros.cores, cor] : filtros.cores.filter((valor) => valor !== cor) })} />{cor}
      </label>)}
    </div>
    {opcoes.length === 0 && <p className="text-xs text-slate-500">Nenhuma cor disponível para essa busca.</p>}
  </fieldset>;
}


function SelectCorrespondencia({ value, onChange, disabled = false }: { value: number; onChange: (value: number) => void; disabled?: boolean }) {
  return <select value={value} onChange={(event) => onChange(Number(event.target.value))} disabled={disabled} className={`${inputClass} disabled:opacity-50`}>
    {[...new Set([1, 50, 75, 100, value])].sort((a, b) => a - b).map((minima) => <option key={minima} value={minima}>
      {minima === 1 ? "Pelo menos uma preferência (busca ampliada)" : minima === 100 ? "100% · todas as preferências" : `Pelo menos ${minima}% das preferências`}
    </option>)}
  </select>;
}

function CorrespondenciaPesquisa({ correspondencia }: { correspondencia: CorrespondenciaEstampa }) {
  const completa = correspondencia.percentual === 100;
  const total = correspondencia.termosEncontrados.length + correspondencia.termosAusentes.length;
  const percentual = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(correspondencia.percentual);
  return <section className={`space-y-2 border-b p-3 ${completa ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`} aria-label="Correspondência com a busca">
    <div className="flex items-center justify-between gap-2">
      <strong className={`text-sm ${completa ? "text-emerald-800" : "text-amber-800"}`}>{percentual}% das preferências</strong>
      <span className="text-xs text-slate-600">{correspondencia.termosEncontrados.length}/{total} critérios</span>
    </div>
    <div role="progressbar" aria-label="Critérios da consulta atendidos" aria-valuenow={correspondencia.percentual} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-white">
      <div className={`h-full ${completa ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${correspondencia.percentual}%` }} />
    </div>
    <p className="text-xs text-slate-700"><span className="font-medium">Encontrados:</span> {correspondencia.termosEncontrados.join(" · ")}</p>
    {correspondencia.termosAusentes.length > 0 && <p className="text-xs text-slate-600"><span className="font-medium">Não encontrados:</span> {correspondencia.termosAusentes.join(" · ")}</p>}
  </section>;
}


function temPreferenciasAtivas(filtros: Filtros) {
  return filtros.preferencias.some((campo) => {
    if (campo === "consulta" && extrairReferenciaCodigo(filtros.consulta)) return false;
    const valor = filtros[campo as keyof Filtros];
    return Array.isArray(valor) ? valor.length > 0 : typeof valor === "string" && Boolean(valor.trim());
  });
}

function PreferenciasPesquisa({ filtros, onChange }: { filtros: Filtros; onChange: (filtros: Filtros) => void }) {
  const selecionados = Object.entries(CRITERIOS_FLEXIVEIS_ESTAMPAS).filter(([campo]) => {
    const valor = filtros[campo as keyof Filtros];
    return Array.isArray(valor) ? valor.length > 0 : typeof valor === "string" && Boolean(valor.trim());
  });
  return <section className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4" aria-label="Critérios obrigatórios e preferências">
    <h3 className="text-sm font-semibold text-slate-900">Obrigatórios ou preferências?</h3>
    <p className="text-xs text-slate-600">Obrigatórios precisam ser atendidos. Preferências ampliam as alternativas e entram no percentual. Código, variante, status e exclusões são sempre obrigatórios, inclusive códigos digitados na pesquisa geral.</p>
    {selecionados.length === 0 ? <p className="text-xs text-slate-500">Preencha critérios para escolher como combiná-los.</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {selecionados.map(([campo, rotulo]) => <label key={campo} className="text-xs text-slate-700">{rotulo}
        <select className={`${inputClass} mt-1`} disabled={campo === "consulta" && Boolean(extrairReferenciaCodigo(filtros.consulta))} value={campo === "consulta" && extrairReferenciaCodigo(filtros.consulta) ? "OBRIGATORIO" : filtros.preferencias.includes(campo) ? "PREFERENCIA" : "OBRIGATORIO"} onChange={(event) => onChange({ ...filtros, preferencias: event.target.value === "PREFERENCIA" ? [...new Set([...filtros.preferencias, campo])] : filtros.preferencias.filter((item) => item !== campo) })}>
          <option value="OBRIGATORIO">Obrigatório</option><option value="PREFERENCIA">Preferência · entra no percentual</option>
        </select>
      </label>)}
    </div>}
  </section>;
}
