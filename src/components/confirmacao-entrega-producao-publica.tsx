"use client";

import Image, { type ImageLoaderProps } from "next/image";
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  LockKeyhole,
  Minus,
  PackageCheck,
  Plus,
  RotateCw,
  X,
} from "lucide-react";

type ItemProducao = {
  id: string;
  sku: string;
  imagemUrl: string | null;
  quantidadeSolicitada: number;
  tipoCorte: string | null;
  observacao: string | null;
};

type SolicitacaoProducao = {
  id: string;
  dataEntrega: string;
  createdAt: string;
  observacaoGeral: string | null;
  prioridadeProducao: boolean;
  periodoInicio: string | null;
  periodoFim: string | null;
  pedidosOlist: string[];
  itens: ItemProducao[];
};

type RespostaListagem = {
  aplicativo?: { nome: string };
  solicitacoes?: SolicitacaoProducao[];
  error?: string;
};

const QUANTIDADE_MAXIMA = 2_147_483_647;
const TOKEN_SESSION_KEY = "confirmacao_producao_public_token";

function imageLoader({ src }: ImageLoaderProps) {
  return src;
}

function formatarData(data: string) {
  const [ano, mes, dia] = data.split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : data;
}

function formatarDataHora(data: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(data));
}

export function ConfirmacaoEntregaProducaoPublica() {
  const [token, setToken] = useState<string | null>(null);
  const [aplicativo, setAplicativo] = useState("");
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoProducao[]>([]);
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  const [recolhidas, setRecolhidas] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [selecionada, setSelecionada] = useState<SolicitacaoProducao | null>(null);
  const [senha, setSenha] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [erroModal, setErroModal] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (token === null) return;
    if (!token) {
      setErro("Link de confirmação inválido ou incompleto.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setErro(null);
    try {
      const response = await fetch(
        "/api/public/confirmacao-entrega-producao",
        {
          cache: "no-store",
          referrerPolicy: "no-referrer",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const dados = await response.json() as RespostaListagem;
      if (!response.ok) {
        if (response.status === 401) {
          try { window.sessionStorage?.removeItem(TOKEN_SESSION_KEY); } catch {}
        }
        throw new Error(dados.error ?? "Não foi possível abrir a confirmação.");
      }

      const lista = dados.solicitacoes ?? [];
      setAplicativo(dados.aplicativo?.nome ?? "Produção");
      setSolicitacoes(lista);
      setQuantidades(
        Object.fromEntries(
          lista.flatMap((solicitacao) =>
            solicitacao.itens.map((item) => [item.id, String(item.quantidadeSolicitada)]),
          ),
        ),
      );
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : "Erro ao carregar os dados.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const parametros = new URLSearchParams(window.location.hash.slice(1));
    const tokenDoLink = parametros.get("token")?.trim();
    let tokenDaSessao = "";
    try {
      if (tokenDoLink) window.sessionStorage?.setItem(TOKEN_SESSION_KEY, tokenDoLink);
      tokenDaSessao = window.sessionStorage?.getItem(TOKEN_SESSION_KEY)?.trim() ?? "";
    } catch {
      // O link continua funcionando quando o navegador bloqueia armazenamento local.
    }
    const tokenEfetivo = tokenDoLink || tokenDaSessao;
    window.history.replaceState(null, "", window.location.pathname);
    setToken(tokenEfetivo);
  }, []);

  useEffect(() => {
    if (token !== null) void carregar();
  }, [carregar, token]);

  function atualizarQuantidade(itemId: string, valor: string) {
    if (valor === "" || /^\d{0,10}$/.test(valor)) {
      setQuantidades((atual) => ({ ...atual, [itemId]: valor }));
    }
  }

  function incrementar(itemId: string, delta: number) {
    const atual = Number(quantidades[itemId] ?? 0);
    const proxima = Math.min(QUANTIDADE_MAXIMA, Math.max(0, atual + delta));
    atualizarQuantidade(itemId, String(proxima));
  }

  function validarSolicitacao(solicitacao: SolicitacaoProducao) {
    const invalido = solicitacao.itens.some((item) => {
      const quantidade = Number(quantidades[item.id]);
      return !Number.isSafeInteger(quantidade)
        || quantidade < 0
        || quantidade > QUANTIDADE_MAXIMA;
    });
    return invalido ? "Revise as quantidades antes de continuar." : null;
  }

  function abrirConfirmacao(solicitacao: SolicitacaoProducao) {
    const mensagemErro = validarSolicitacao(solicitacao);
    if (mensagemErro) {
      setErro(mensagemErro);
      return;
    }
    setErro(null);
    setErroModal(null);
    setSenha("");
    setSelecionada(solicitacao);
  }

  async function confirmar() {
    if (!selecionada || confirmando) return;
    if (!senha) {
      setErroModal("Digite a senha para confirmar.");
      return;
    }

    setConfirmando(true);
    setErroModal(null);
    try {
      const response = await fetch(
        "/api/public/confirmacao-entrega-producao",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token ?? ""}`,
            "Content-Type": "application/json",
          },
          referrerPolicy: "no-referrer",
          body: JSON.stringify({
            solicitacaoId: selecionada.id,
            senha,
            itens: selecionada.itens.map((item) => ({
              id: item.id,
              quantidadeProduzida: Number(quantidades[item.id]),
            })),
          }),
        },
      );
      const dados = await response.json() as { error?: string };
      if (!response.ok) throw new Error(dados.error ?? "Não foi possível confirmar.");

      setSolicitacoes((atuais) => {
        const restantes = atuais.filter((item) => item.id !== selecionada.id);
        if (restantes.length === 0) {
          try { window.sessionStorage?.removeItem(TOKEN_SESSION_KEY); } catch {}
        }
        return restantes;
      });
      setSucesso(`Entrega de ${formatarData(selecionada.dataEntrega)} confirmada com sucesso.`);
      setSelecionada(null);
      setSenha("");
    } catch (cause) {
      setSenha("");
      setErroModal(cause instanceof Error ? cause.message : "Erro ao confirmar a entrega.");
    } finally {
      setConfirmando(false);
    }
  }

  if (loading) return <EstadoCarregando />;

  if (erro && solicitacoes.length === 0) {
    return <EstadoErro mensagem={erro} onRetry={() => void carregar()} />;
  }

  return (
    <div className="min-h-dvh bg-slate-50 pb-10 text-slate-950">
      <header className="bg-slate-950 px-4 pb-7 pt-[max(1.25rem,env(safe-area-inset-top))] text-white">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400 text-slate-950">
              <PackageCheck className="h-6 w-6" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
                {aplicativo}
              </p>
              <h1 className="text-xl font-bold">Confirmar entrega</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto -mt-3 max-w-2xl space-y-4 px-3 sm:px-4">
        {sucesso && (
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900" role="status">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <span>{sucesso}</span>
          </div>
        )}
        {erro && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="alert">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <span>{erro}</span>
          </div>
        )}

        {solicitacoes.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-bold">Entrega sem pendência</h2>
            <p className="mt-1 text-sm text-slate-600">Esta solicitação não está mais aguardando confirmação.</p>
          </div>
        ) : solicitacoes.map((solicitacao) => {
          const recolhida = Boolean(recolhidas[solicitacao.id]);
          const unidades = solicitacao.itens.reduce(
            (total, item) => total + item.quantidadeSolicitada,
            0,
          );
          return (
            <section key={solicitacao.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              {solicitacao.prioridadeProducao && (
                <div className="bg-rose-600 px-4 py-2 text-center text-xs font-black uppercase tracking-[0.16em] text-white">
                  Prioridade
                </div>
              )}
              <div className="p-4 sm:p-5">
                <button
                  type="button"
                  className="flex min-h-12 w-full items-start justify-between gap-3 text-left"
                  onClick={() => setRecolhidas((atual) => ({
                    ...atual,
                    [solicitacao.id]: !recolhida,
                  }))}
                  aria-expanded={!recolhida}
                >
                  <span className="min-w-0">
                    <span className="block whitespace-pre-line break-words text-base font-bold">
                      {solicitacao.observacaoGeral?.trim() || "Pedido de produção"}
                    </span>
                    <span className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                      <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
                      Entrega {formatarData(solicitacao.dataEntrega)}
                    </span>
                    <span className="mt-1 block text-sm text-slate-500">
                      {solicitacao.itens.length} item(ns) · {unidades} unidade(s)
                    </span>
                  </span>
                  {recolhida
                    ? <ChevronDown className="mt-1 h-5 w-5 shrink-0 text-slate-500" />
                    : <ChevronUp className="mt-1 h-5 w-5 shrink-0 text-slate-500" />}
                </button>

                {!recolhida && (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-2xl bg-slate-50 px-3 py-3 text-xs text-slate-600">
                      <p><strong>Criada:</strong> {formatarDataHora(solicitacao.createdAt)}</p>
                      {solicitacao.pedidosOlist.length > 0 && (
                        <p className="mt-1 break-words"><strong>Pedido Olist:</strong> {solicitacao.pedidosOlist.join(", ")}</p>
                      )}
                    </div>

                    <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
                      {solicitacao.itens.map((item) => (
                        <article key={item.id} className="p-3">
                          <div className="flex gap-3">
                            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-100">
                              {item.imagemUrl ? (
                                <Image
                                  loader={imageLoader}
                                  unoptimized
                                  src={item.imagemUrl}
                                  alt=""
                                  fill
                                  sizes="56px"
                                  className="object-cover"
                                />
                              ) : (
                                <span className="flex h-full items-center justify-center text-[10px] text-slate-400">Sem foto</span>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="break-words text-sm font-bold text-slate-900">{item.sku}</p>
                              <p className="mt-0.5 text-xs text-slate-500">
                                Solicitado: {item.quantidadeSolicitada}
                                {item.tipoCorte === "LASER" ? " · Corte a laser" : ""}
                              </p>
                              {item.observacao && <p className="mt-1 text-xs text-slate-600">{item.observacao}</p>}
                            </div>
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold text-slate-700">Quantidade entregue</span>
                            <div className="flex items-center rounded-xl border border-slate-300 bg-white p-1">
                              <button
                                type="button"
                                onClick={() => incrementar(item.id, -1)}
                                className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-700 active:bg-slate-100"
                                aria-label={`Diminuir quantidade de ${item.sku}`}
                              >
                                <Minus className="h-5 w-5" />
                              </button>
                              <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                max={QUANTIDADE_MAXIMA}
                                value={quantidades[item.id] ?? ""}
                                onChange={(event) => atualizarQuantidade(item.id, event.target.value)}
                                aria-label={`Quantidade entregue de ${item.sku}`}
                                className="h-11 w-16 border-x border-slate-200 text-center text-lg font-bold outline-none focus:bg-emerald-50"
                              />
                              <button
                                type="button"
                                onClick={() => incrementar(item.id, 1)}
                                className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-700 active:bg-slate-100"
                                aria-label={`Aumentar quantidade de ${item.sku}`}
                              >
                                <Plus className="h-5 w-5" />
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => abrirConfirmacao(solicitacao)}
                      className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-base font-bold text-slate-950 shadow-sm active:bg-emerald-600"
                    >
                      <Check className="h-5 w-5" aria-hidden="true" />
                      Confirmar esta entrega
                    </button>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </main>

      {selecionada && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-modal-confirmacao"
            className="w-full rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-md sm:rounded-3xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                  <LockKeyhole className="h-5 w-5" aria-hidden="true" />
                </span>
                <h2 id="titulo-modal-confirmacao" className="mt-4 text-xl font-bold">Autorizar confirmação</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Digite a senha para confirmar a entrega de {formatarData(selecionada.dataEntrega)}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelecionada(null)}
                disabled={confirmando}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              className="mt-5"
              onSubmit={(event) => {
                event.preventDefault();
                void confirmar();
              }}
            >
              <label className="block text-sm font-semibold text-slate-800">
                Senha
                <input
                  autoFocus
                  type="password"
                  autoComplete="current-password"
                  value={senha}
                  onChange={(event) => setSenha(event.target.value)}
                  disabled={confirmando}
                  className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 text-base outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                  placeholder="Digite a senha"
                />
              </label>
              {erroModal && (
                <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700" role="alert">{erroModal}</p>
              )}
              <button
                type="submit"
                disabled={confirmando}
                className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-base font-bold text-white disabled:opacity-60"
              >
                {confirmando ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                {confirmando ? "Confirmando..." : "Confirmar entrega"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function EstadoCarregando() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-6">
      <div className="text-center">
        <LoaderCircle className="mx-auto h-9 w-9 animate-spin text-emerald-600" />
        <p className="mt-3 text-sm font-medium text-slate-600">Carregando produções...</p>
      </div>
    </div>
  );
}

function EstadoErro({ mensagem, onRetry }: { mensagem: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <AlertCircle className="mx-auto h-11 w-11 text-rose-500" />
        <h1 className="mt-4 text-xl font-bold">Não foi possível abrir</h1>
        <p className="mt-2 text-sm text-slate-600">{mensagem}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 font-bold text-white"
        >
          <RotateCw className="h-5 w-5" />
          Tentar novamente
        </button>
      </div>
    </div>
  );
}
