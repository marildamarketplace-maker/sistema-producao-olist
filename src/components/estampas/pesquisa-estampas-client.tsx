"use client";

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
  type ConteudoImagemEstampa,
  type SuporteAplicacaoEstampa,
  type TipoImagemEstampa,
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

type Facetas = {
  temas: string[];
  cores: string[];
  elementosVisuais: string[];
  categorias: string[];
  ocasioes: string[];
  publicosSugeridos: string[];
  contextosUso: string[];
  afinidadesVisuais: string[];
  padroesTexteis: string[];
  tiposImagem: TipoImagemEstampa[];
  conteudosImagem: ConteudoImagemEstampa[];
  suportesAplicacao: SuporteAplicacaoEstampa[];
};

type Filtros = FiltrosPesquisaEstampasUrl;
const FILTROS_INICIAIS = FILTROS_VAZIOS_PESQUISA_ESTAMPAS;

const FACETAS_VAZIAS: Facetas = {
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
  const [facetasCarregadas, setFacetasCarregadas] = useState(false);
  const [resultado, setResultado] = useState<ResultadoPesquisaEstampasCatalogo | null>(null);
  const [pagina, setPagina] = useState(estadoInicial.pagina);
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
      const params = criarQueryPesquisaEstampas(filtros, pagina, ordenacao);
      const response = await fetch(`/api/estampas/pesquisa?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
        signal,
      });
      const dados = await response.json();
      if (!response.ok) throw new Error(dados.error ?? "Erro ao pesquisar estampas.");
      setResultado(dados);
    } catch (cause) {
      if (signal.aborted) return;
      setErro(cause instanceof Error ? cause.message : "Erro ao pesquisar estampas.");
    } finally {
      if (!signal.aborted) setCarregando(false);
    }
  }, [filtros, ordenacao, pagina, session?.access_token]);

  const carregarFacetas = useCallback(async () => {
    if (!session?.access_token || facetasCarregadas) return;
    try {
      const response = await fetch("/api/estampas/pesquisa?facetas=1", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
      });
      const dados = await response.json();
      if (!response.ok) throw new Error(dados.error ?? "Erro ao carregar filtros.");
      setFacetas(dados.facetas);
      setFacetasCarregadas(true);
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : "Erro ao carregar filtros.");
    }
  }, [facetasCarregadas, session?.access_token]);

  useEffect(() => {
    const estado = lerEstadoUrlPesquisaEstampas(new URLSearchParams(queryAtual));
    const filtrosUrl = copiarFiltrosPesquisaEstampas(estado.filtros);
    setForm(filtrosUrl);
    setPagina(estado.pagina);
    setOrdenacao(estado.ordenacao);
    setSelecionada(null);
    setImagemAmpliada(null);
    setResultado(null);
    setErro(null);
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
      if (event.key === "Escape") cancelarFiltrosAvancados();
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
    const proximaOrdenacao = form.consulta.trim() ? "RELEVANCIA" : "RECENTES";
    setErro(null);
    filtrosAntesDoModal.current = null;
    setFiltrosAvancadosAbertos(false);
    atualizarUrl(form, 1, proximaOrdenacao);
  }

  function abrirFiltrosAvancados() {
    filtrosAntesDoModal.current = { ...form, cores: [...form.cores] };
    setFiltrosAvancadosAbertos(true);
    void carregarFacetas();
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
    setOrdenacao("RECENTES");
    setFiltrosAvancadosAbertos(false);
    if (queryAtual) router.push(pathname, { scroll: false });
  }

  function atualizarUrl(
    proximosFiltros: Filtros,
    proximaPagina: number,
    proximaOrdenacao: OrdenacaoUrlPesquisaEstampas,
  ) {
    const query = criarQueryPesquisaEstampas(
      proximosFiltros,
      proximaPagina,
      proximaOrdenacao,
    ).toString();
    if (query === queryAtual) {
      setPagina(proximaPagina);
      setOrdenacao(proximaOrdenacao);
      setResultado(null);
      setFiltros(copiarFiltrosPesquisaEstampas(proximosFiltros));
      return;
    }
    router.push(`${pathname}?${query}`, { scroll: false });
  }

  async function compartilharResultado() {
    try {
      await navigator.clipboard.writeText(window.location.href);
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
        description="Localize rapidamente estampas por código, conteúdo visual e metadados da análise de IA."
      />

      <form onSubmit={pesquisar} className="space-y-5 rounded-lg border border-slate-200 bg-white p-5">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Pesquisa geral</span>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-400" />
            <input
              value={form.consulta}
              onChange={(event) => setForm({ ...form, consulta: event.target.value })}
              placeholder="Código, tema, cores, elementos ou palavras-chave..."
              maxLength={200}
              className="w-full rounded-md border border-slate-300 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />
          </div>
        </label>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Campo label="Código">
            <input value={form.codigo} onChange={(event) => setForm({ ...form, codigo: event.target.value })} placeholder="6844" className={inputClass} />
          </Campo>
          <Campo label="Variante">
            <input value={form.variante} onChange={(event) => setForm({ ...form, variante: event.target.value })} placeholder="A" className={inputClass} />
          </Campo>
          <Campo label="Status">
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Filtros["status"] })} className={inputClass}>
              <option value="">Selecione um status</option>
              {['COMPLETED', 'PENDING', 'PROCESSING', 'FAILED', 'TODOS'].map((status) => <option key={status}>{status}</option>)}
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

      {resultado && <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{carregando ? "Pesquisando..." : `${resultado.total} resultado(s) encontrado(s)`}</p>
        <div className="flex flex-wrap items-center gap-3">
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
              <option value="RELEVANCIA">Relevância</option>
              <option value="RECENTES">Mais recentes</option>
              <option value="CODIGO_ASC">Código crescente</option>
              <option value="CODIGO_DESC">Código decrescente</option>
            </select>
          </label>
          <button
            type="button"
            onClick={compartilharResultado}
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
        <section className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Nenhuma estampa encontrada com os filtros informados.</section>
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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="titulo-filtros-avancados">
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
            <input value={filtros.consulta} onChange={(event) => onChange({ ...filtros, consulta: event.target.value })} placeholder="Código, tema, cores, elementos ou palavras-chave..." maxLength={200} className={inputClass} />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Campo label="Código">
              <input value={filtros.codigo} onChange={(event) => onChange({ ...filtros, codigo: event.target.value })} placeholder="6844" className={inputClass} />
            </Campo>
            <Campo label="Variante">
              <input value={filtros.variante} onChange={(event) => onChange({ ...filtros, variante: event.target.value })} placeholder="A" className={inputClass} />
            </Campo>
            <Campo label="Status">
              <select value={filtros.status} onChange={(event) => onChange({ ...filtros, status: event.target.value as Filtros["status"] })} className={inputClass}>
                <option value="">Selecione um status</option>
                {['COMPLETED', 'PENDING', 'PROCESSING', 'FAILED', 'TODOS'].map((status) => <option key={status}>{status}</option>)}
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

          <Campo label="Cores" hint="Use Command/Ctrl para selecionar mais de uma.">
            <select
              multiple
              value={filtros.cores}
              onChange={(event) => onChange({ ...filtros, cores: Array.from(event.target.selectedOptions, (option) => option.value) })}
              className={`${inputClass} min-h-36`}
            >
              {facetas.cores.map((cor) => <option key={cor} value={cor}>{cor}</option>)}
            </select>
          </Campo>
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
        <InfoCompacta label="Público sugerido" valores={estampa.publicosSugeridos.slice(0, 3)} />
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
    ? <img src={estampa.previewUrl} alt={`Preview da estampa ${codigoCompleto(estampa)}`} loading="lazy" className={`${className} bg-slate-100 object-cover`} />
    : <div className={`${className} flex items-center justify-center bg-slate-100 text-sm text-slate-500`}>Sem preview</div>;
}

function Campo({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-sm font-medium text-slate-700">{label}</span>{hint && <span className="ml-2 text-xs text-slate-500">{hint}</span>}<div className="mt-1">{children}</div></label>;
}

function Select({ value, onChange, options, placeholder }: { value: string; onChange: (value: string) => void; options: string[]; placeholder: string }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}><option value="">{placeholder}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
}

function SelectRotulado<T extends string>({ value, onChange, options, labels, placeholder }: { value: string; onChange: (value: string) => void; options: readonly T[]; labels: Record<T, string>; placeholder: string }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}><option value="">{placeholder}</option>{options.map((option) => <option key={option} value={option}>{labels[option]}</option>)}</select>;
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
