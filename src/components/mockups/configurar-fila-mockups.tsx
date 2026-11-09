"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { useModalFocus } from "@/hooks/use-modal-focus";
import { useSelecaoEstampasMockups } from "@/hooks/use-selecao-estampas-mockups";
import {
  alternarSelecao,
  MAX_ESTAMPAS_LAYOUT,
  MAX_MODELOS_MOCKUPS,
  MAX_SAIDAS_MOCKUPS,
  type EstampaSelecionadaMockup,
  type TrabalhoMockup,
} from "@/lib/fila-mockups-contrato";
import { mensagemMockups, requisitarMockups } from "@/lib/mockups-client";
import type { Mockup } from "@/lib/mockups";
import { VisualizacaoMockup } from "./visualizacao-mockup";

const painel = "min-w-0 space-y-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-5";
const secundario = "inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50";
const opcao = "flex min-h-11 min-w-0 items-center gap-3 py-2 text-sm";
type Vinculos = Record<string, string[]>;

export function ConfigurarFilaMockups() {
  const { usuario, session } = useAuth();
  const pesquisa = useSearchParams().toString();
  const voltar = `/controle-midia/estampas${pesquisa ? `?${pesquisa}` : ""}`;
  const escopo = usuario?.podeEditarEstampas ? `${usuario.aplicativo_id}:${usuario.id}` : null;
  const selecao = useSelecaoEstampasMockups(escopo);

  return (
    <div className="space-y-6">
      <PageHeader title="Criar mockups" description="Defina quais estampas entram em cada mockup e salve o lote na fila." />
      <Link href={voltar} className={secundario}>Voltar à pesquisa</Link>
      {!selecao.pronto && <p role="status" className="text-sm text-slate-600">Carregando seleção…</p>}
      {selecao.pronto && !selecao.itens.length && (
        <p className={`${painel} text-sm`}>Selecione estampas na pesquisa para configurar um lote.</p>
      )}
      {session && selecao.pronto && selecao.itens.length > 0 && (
        <FormularioFila key={escopo} token={session.access_token} estampas={selecao.itens} />
      )}
    </div>
  );
}

function FormularioFila({ token, estampas }: { token: string; estampas: EstampaSelecionadaMockup[] }) {
  const [mockups, setMockups] = useState<Mockup[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroCatalogo, setErroCatalogo] = useState("");
  const [tentativa, setTentativa] = useState(0);
  const [estampaAtiva, setEstampaAtiva] = useState(estampas[0].id);
  const [layoutAtivo, setLayoutAtivo] = useState("");
  const [individuais, setIndividuais] = useState<Vinculos>({});
  const [layouts, setLayouts] = useState<Vinculos>({});
  const [preview, setPreview] = useState<Mockup | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState<{ loteId: string; quantidade: number } | null>(null);
  const reenvio = useRef<{ assinatura: string; loteId: string } | null>(null);
  const confirmacao = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setCarregando(true);
    setErroCatalogo("");
    requisitarMockups(token, "", { signal: controller.signal })
      .then((response) => response.json())
      .then((dados: { mockups: Mockup[]; cursor: string | null }) => {
        if (controller.signal.aborted) return;
        setMockups((atuais) => [...new Map([...atuais, ...dados.mockups].map((item) => [item.id, item])).values()]);
        setCursor(dados.cursor);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setErroCatalogo(mensagemMockups(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setCarregando(false);
      });
    return () => controller.abort();
  }, [token, tentativa]);

  useEffect(() => { if (salvo) confirmacao.current?.focus(); }, [salvo]);

  async function carregarMais() {
    if (!cursor || carregando) return;
    setCarregando(true);
    setErroCatalogo("");
    try {
      const response = await requisitarMockups(token, `?cursor=${encodeURIComponent(cursor)}`);
      const dados = await response.json() as { mockups: Mockup[]; cursor: string | null };
      setMockups((atuais) => [...new Map([...atuais, ...dados.mockups].map((item) => [item.id, item])).values()]);
      setCursor(dados.cursor);
    } catch (error) {
      setErroCatalogo(mensagemMockups(error));
    } finally {
      setCarregando(false);
    }
  }

  const trabalhos: TrabalhoMockup[] = estampas.flatMap(({ id }) =>
    (individuais[id] ?? []).map((mockupId) => ({ mockupId, estampaIds: [id] })),
  );
  for (const mockup of mockups) {
    const estampaIds = layouts[mockup.id];
    if (estampaIds?.length) trabalhos.push({ mockupId: mockup.id, estampaIds });
  }
  const usadas = new Set(trabalhos.flatMap(({ estampaIds }) => estampaIds));
  const modelos = new Set(trabalhos.map(({ mockupId }) => mockupId));
  const pendentes = estampas.filter(({ id }) => !usadas.has(id));
  const limiteExcedido = trabalhos.length > MAX_SAIDAS_MOCKUPS || modelos.size > MAX_MODELOS_MOCKUPS;
  const codigos = new Map(estampas.map(({ id, codigo }) => [id, codigo]));
  const nomes = new Map(mockups.map(({ id, nome }) => [id, nome]));

  async function salvar() {
    if (salvando || salvo || pendentes.length || limiteExcedido) return;
    const lote = { estampas: estampas.map(({ id }) => id), trabalhos };
    const assinatura = JSON.stringify(lote);
    if (reenvio.current?.assinatura !== assinatura) {
      reenvio.current = { assinatura, loteId: crypto.randomUUID() };
    }
    setSalvando(true);
    setErro("");
    try {
      const response = await requisitarMockups(token, "/fila", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...lote, loteId: reenvio.current.loteId }),
      });
      setSalvo(await response.json());
    } catch (error) {
      setErro(mensagemMockups(error));
    } finally {
      setSalvando(false);
    }
  }

  if (salvo) return (
    <section className={painel}>
      <h2 ref={confirmacao} tabIndex={-1} className="font-semibold text-emerald-700 dark:text-emerald-300">Lote salvo na fila</h2>
      <p role="status" className="text-sm">{salvo.quantidade} {salvo.quantidade === 1 ? "saída pendente" : "saídas pendentes"}.</p>
      <p className="break-all text-xs text-slate-600">Lote {salvo.loteId}</p>
    </section>
  );

  const layoutsDisponiveis = mockups.filter(({ tipo }) => tipo === "LAYOUT");
  const individuaisDisponiveis = mockups.filter(({ tipo }) => tipo === "INDIVIDUAL");
  const idLayout = layoutAtivo || layoutsDisponiveis[0]?.id;
  const layout = layoutsDisponiveis.find(({ id }) => id === idLayout);

  return (
    <div className="space-y-4">
      {erroCatalogo && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{erroCatalogo}</p>}
      {carregando && <p role="status" className="text-sm text-slate-600">Carregando mockups…</p>}
      {!carregando && !erroCatalogo && !mockups.length && (
        <p className="text-sm text-slate-600">Nenhum mockup disponível. Cadastre um modelo em Controle de mídia → Mockups.</p>
      )}
      <fieldset disabled={salvando} className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
        <section className={painel}>
          <h2 className="font-semibold">Mockups por estampa</h2>
          <p className="text-sm text-slate-600">Escolha uma estampa e marque todos os modelos que deseja aplicar nela.</p>
          <label className="block text-sm font-medium">
            Estampa
            <select className="input mt-1 min-h-11" value={estampaAtiva} onChange={(event) => setEstampaAtiva(event.target.value)}>
              {estampas.map(({ id, codigo }) => (
                <option key={id} value={id}>{codigo} ({individuais[id]?.length ?? 0} individuais)</option>
              ))}
            </select>
          </label>
          {individuaisDisponiveis.length > 0 && (
            <ul className="divide-y divide-slate-200">
              {individuaisDisponiveis.map((mockup) => (
                <li key={mockup.id} className="flex flex-wrap items-center justify-between gap-x-3">
                  <label className={`${opcao} flex-1`}>
                    <input type="checkbox" className="h-4 w-4 shrink-0 accent-slate-900"
                      checked={individuais[estampaAtiva]?.includes(mockup.id) ?? false}
                      onChange={() => setIndividuais((atual) => ({
                        ...atual, [estampaAtiva]: alternarSelecao(atual[estampaAtiva] ?? [], mockup.id),
                      }))} />
                    <span className="break-all">{mockup.nome}</span>
                  </label>
                  <button type="button" className={secundario} onClick={() => setPreview(mockup)}
                    aria-label={`Visualizar ${mockup.nome}`}>Visualizar</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={painel}>
          <h2 className="font-semibold">Estampas por layout</h2>
          <p className="text-sm text-slate-600">Escolha o layout e marque até {MAX_ESTAMPAS_LAYOUT} estampas na ordem em que devem ser aplicadas.</p>
          {layout ? (
            <>
              <label className="block text-sm font-medium">
                Layout
                <select className="input mt-1 min-h-11" value={layout.id} onChange={(event) => setLayoutAtivo(event.target.value)}>
                  {layoutsDisponiveis.map(({ id, nome }) => (
                    <option key={id} value={id}>{nome} ({layouts[id]?.length ?? 0} estampas)</option>
                  ))}
                </select>
              </label>
              <button type="button" className={secundario} onClick={() => setPreview(layout)}>Visualizar layout</button>
              <ul className="divide-y divide-slate-200">
                {estampas.map(({ id, codigo }) => {
                  const ordem = (layouts[layout.id] ?? []).indexOf(id);
                  return (
                    <li key={id}>
                      <label className={opcao}>
                        <input type="checkbox" className="h-4 w-4 shrink-0 accent-slate-900"
                          checked={ordem !== -1} disabled={ordem === -1 && (layouts[layout.id]?.length ?? 0) >= MAX_ESTAMPAS_LAYOUT} onChange={() => setLayouts((atual) => ({
                            ...atual, [layout.id]: alternarSelecao(atual[layout.id] ?? [], id),
                          }))} />
                        <span className="break-all">{codigo}{ordem !== -1 && ` · posição ${ordem + 1}`}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : <p className="text-sm text-slate-600">Nenhum layout nas páginas carregadas.</p>}
        </section>
      </fieldset>

      {cursor && <button type="button" className={secundario} disabled={carregando || salvando} onClick={carregarMais}>Carregar mais mockups</button>}
      {erroCatalogo && !cursor && (
        <button type="button" className={secundario} disabled={carregando || salvando} onClick={() => setTentativa((valor) => valor + 1)}>Recarregar mockups</button>
      )}

      {preview && <PreviaMockup key={preview.id} mockup={preview} token={token} fechar={() => setPreview(null)} />}

      <section className={painel}>
        <h2 className="font-semibold">Revisão do lote</h2>
        <p role="status" className="text-sm text-slate-700">
          {usadas.size} de {estampas.length} estampas vinculadas · {modelos.size} mockups · {trabalhos.length} saídas
        </p>
        {pendentes.length > 0 && (
          <p className="break-words text-sm text-slate-600">Vincule as estampas pendentes. {pendentes.map(({ codigo }) => codigo).join(", ")}</p>
        )}
        {limiteExcedido && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            Use até {MAX_MODELOS_MOCKUPS} mockups e {MAX_SAIDAS_MOCKUPS} saídas por lote.
          </p>
        )}
        {trabalhos.length > 0 && (
          <details className="rounded-md border border-slate-200 px-3">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Conferir combinações</summary>
            <ul className="max-h-72 divide-y divide-slate-200 overflow-y-auto text-sm">
              {trabalhos.map(({ mockupId, estampaIds }) => (
                <li key={`${mockupId}/${estampaIds.join(",")}`} className="break-words py-2">
                  <strong>{nomes.get(mockupId)}</strong> · {estampaIds.map((id) => codigos.get(id)).join(" → ")}
                </li>
              ))}
            </ul>
          </details>
        )}
        {erro && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{erro}</p>}
        <button type="button" onClick={salvar} disabled={salvando || pendentes.length > 0 || limiteExcedido}
          className="min-h-11 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 sm:w-auto">
          {salvando ? "Salvando na fila…" : "Salvar na fila"}
        </button>
      </section>
    </div>
  );
}

function PreviaMockup({ mockup, token, fechar }: { mockup: Mockup; token: string; fechar: () => void }) {
  const modal = useModalFocus(fechar);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div ref={modal} role="dialog" aria-modal="true" aria-label="Prévia do mockup" tabIndex={-1}
        className={`${painel} max-h-[85dvh] w-full max-w-2xl overflow-y-auto`}>
        <button type="button" className={secundario} onClick={fechar}>Fechar prévia</button>
        <VisualizacaoMockup mockup={mockup} token={token} />
      </div>
    </div>
  );
}
