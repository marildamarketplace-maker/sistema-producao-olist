"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { useModalFocus } from "@/hooks/use-modal-focus";
import { PageHeader } from "@/components/page-header";
import { mensagemMockups, requisitarMockups } from "@/lib/mockups-client";
import { ImagemPrivadaMockup } from "./visualizacao-mockup";

type Saida = { numero: number; nome: string; estampas: string[]; status: "PENDING" | "COMPLETED" | "FAILED"; erro?: string };
type Lote = { status: string; saidas: Saida[] };

const rotulos = { PENDING: "Na fila", PROCESSING: "Em processamento", COMPLETED: "Gerado", FAILED: "Concluído com falhas" };
const erros: Record<string, string> = {
  ESTAMPA_SEM_PREVIEW: "A estampa está sem imagem de referência.",
  MOCKUP_INDISPONIVEL: "O modelo ficou indisponível.",
  COMBINACAO_INVALIDA: "Revise a combinação de estampas e modelo.",
  INVALID_RESPONSE: "O Codex não retornou uma imagem válida.",
  RATE_LIMIT: "O limite de uso do Codex foi atingido.",
  TIMEOUT: "O tempo de geração foi excedido.",
};
const botao = "inline-flex min-h-11 items-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100";

export function AcompanharLoteMockups({ loteId }: { loteId: string }) {
  const { session } = useAuth();
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="Detalhes da solicitação de mockups" description="Acompanhe o processamento e veja todas as imagens salvas desta solicitação." />
      <Link className={botao} href="/controle-midia/estampas">Voltar à pesquisa</Link>
      {session?.access_token && <StatusLote key={`${session.user.id}:${loteId}`} loteId={loteId} token={session.access_token} />}
    </div>
  );
}

function StatusLote({ loteId, token }: { loteId: string; token: string }) {
  const [lote, setLote] = useState<Lote | null>(null);
  const [erro, setErro] = useState("");
  const [tentativa, setTentativa] = useState(0);
  const [preview, setPreview] = useState<Saida | null>(null);
  const [recriacao, setRecriacao] = useState<{ id: string; saida?: Saida } | null>(null);
  const rota = `/fila?loteId=${encodeURIComponent(loteId)}`;

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function consultar() {
      setErro("");
      try {
        const response = await requisitarMockups(token, rota, { signal: controller.signal });
        const dados = await response.json() as Lote;
        if (controller.signal.aborted) return;
        setLote(dados);
        if (dados.status === "PENDING" || dados.status === "PROCESSING") timer = setTimeout(consultar, 10_000);
      } catch (error) {
        if (!controller.signal.aborted) setErro(mensagemMockups(error));
      }
    }
    void consultar();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [rota, token, tentativa]);

  const imagens = lote?.saidas.filter(({ status }) => status === "COMPLETED") ?? [];
  const outrasSaidas = lote?.saidas.filter(({ status }) => status !== "COMPLETED") ?? [];
  const concluidas = imagens.length;
  const falhas = outrasSaidas.filter(({ status }) => status === "FAILED").length;
  const rotaImagem = (saida: Saida) => `${rota}&saida=${saida.numero}`;

  return (
    <section className="min-w-0 space-y-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{lote ? rotulos[lote.status as keyof typeof rotulos] ?? lote.status : "Progresso"}</h2>
          <p className="break-all text-xs text-slate-600">Lote {loteId}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={botao} type="button" onClick={() => setTentativa((valor) => valor + 1)}>Atualizar</button>
          {(lote?.status === "COMPLETED" || lote?.status === "FAILED") && (
            <button className={botao} type="button" onClick={() => setRecriacao({ id: crypto.randomUUID() })}>
              Recriar lote inteiro
            </button>
          )}
        </div>
      </div>
      {erro && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{erro}</p>}
      {!lote && !erro && <p role="status" className="text-sm text-slate-600">Consultando o lote…</p>}
      {lote && (
        <>
          <p role="status" className="text-sm">{concluidas} de {lote.saidas.length} imagens geradas · {falhas} com falha</p>
          <progress aria-label="Saídas processadas" className="w-full accent-slate-900 dark:accent-slate-300"
            max={Math.max(lote.saidas.length, 1)} value={concluidas + falhas} />
          {lote.status === "PENDING" && <p className="text-sm text-slate-600">Aguardando o worker local ou a próxima tentativa.</p>}
          <section aria-labelledby="imagens-geradas" className="space-y-3">
            <h3 id="imagens-geradas" className="font-semibold">Imagens geradas ({concluidas})</h3>
            {imagens.length ? (
              <ul className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {imagens.map((saida) => (
                  <li key={saida.numero} className="min-w-0 space-y-3 rounded-lg border border-slate-200 p-3">
                    <ImagemPrivadaMockup token={token} rota={rotaImagem(saida)} miniatura
                      nome={`Saída ${saida.numero}, ${saida.nome}: ${saida.estampas.join(", ")}`} />
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium">{saida.numero}. {saida.nome}</p>
                      <p className="break-words text-xs text-slate-600">{saida.estampas.join(" → ")}</p>
                    </div>
                    <button type="button" className={`${botao} w-full justify-center sm:w-auto`}
                      onClick={() => setPreview(saida)} aria-label={`Visualizar saída ${saida.numero}`}>
                      Ampliar e baixar
                    </button>
                    <button type="button" className={`${botao} w-full justify-center sm:w-auto`}
                      onClick={() => setRecriacao({ id: crypto.randomUUID(), saida })}
                      aria-label={`Recriar saída ${saida.numero}`}>
                      Recriar imagem
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-600">As imagens aparecem aqui à medida que forem salvas no armazenamento.</p>}
          </section>
          {outrasSaidas.length > 0 && (
            <section aria-labelledby="saidas-pendentes" className="space-y-3">
              <h3 id="saidas-pendentes" className="font-semibold">Saídas pendentes ou com falha</h3>
              <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
                {outrasSaidas.map((saida) => (
                  <li key={saida.numero} className="min-w-0 space-y-1 p-3 text-sm">
                    <p className="break-words font-medium">{saida.numero}. {saida.nome}</p>
                    <p className="break-words text-xs text-slate-600">{saida.estampas.join(" → ")}</p>
                    <p className="text-slate-600">{saida.status === "FAILED"
                      ? erros[saida.erro ?? ""] ?? "Falha ao gerar a imagem."
                      : rotulos[saida.status]}</p>
                    {saida.status === "FAILED" && (
                      <button type="button" className={botao} onClick={() => setRecriacao({ id: crypto.randomUUID(), saida })}
                        aria-label={`Recriar saída ${saida.numero}`}>Recriar imagem</button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {recriacao && <ConfirmarRecriacao key={recriacao.id} token={token} origemLoteId={loteId}
            loteId={recriacao.id} saida={recriacao.saida} quantidade={recriacao.saida ? 1 : lote.saidas.length}
            fechar={() => setRecriacao(null)} />}
          {preview && <PreviaSaida key={preview.numero} token={token} saida={preview}
            rota={rotaImagem(preview)} arquivo={`mockup-${loteId}-${preview.numero}.webp`}
            fechar={() => setPreview(null)} />}
        </>
      )}
    </section>
  );
}

function PreviaSaida({ token, saida, rota, arquivo, fechar }: {
  token: string; saida: Saida; rota: string; arquivo: string; fechar: () => void;
}) {
  const modal = useModalFocus(fechar);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div ref={modal} role="dialog" aria-modal="true" aria-label="Imagem gerada" tabIndex={-1}
        className="max-h-[85dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <button type="button" className={botao} onClick={fechar}>Fechar prévia</button>
        <ImagemPrivadaMockup token={token} nome={saida.nome} rota={rota} arquivo={arquivo} />
      </div>
    </div>
  );
}

function ConfirmarRecriacao({ token, origemLoteId, loteId, saida, quantidade, fechar }: {
  token: string; origemLoteId: string; loteId: string; saida?: Saida; quantidade: number; fechar: () => void;
}) {
  const router = useRouter();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const modal = useModalFocus(() => { if (!salvando) fechar(); });

  async function confirmar() {
    if (salvando) return;
    setErro("");
    setSalvando(true);
    try {
      const resposta = await requisitarMockups(token, "/fila", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loteId, origemLoteId, saida: saida?.numero }),
      });
      const dados: { loteId: string } = await resposta.json();
      router.push(`/controle-midia/estampas/criar-mockups/lote/${encodeURIComponent(dados.loteId)}`);
    } catch (error) {
      setErro(mensagemMockups(error));
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div ref={modal} role="dialog" aria-modal="true" aria-labelledby="titulo-recriacao" tabIndex={-1}
        className="max-h-[85dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-lg border border-slate-200 bg-white p-5">
        <h3 id="titulo-recriacao" className="font-semibold">{saida ? `Recriar saída ${saida.numero}` : "Recriar lote inteiro"}</h3>
        <p className="text-sm text-slate-600">
          Uma nova solicitação com {quantidade} {quantidade === 1 ? "imagem" : "imagens"} será enviada para a fila.
          As combinações e a observação do lote original serão usadas na nova geração.
        </p>
        {erro && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{erro}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${botao} disabled:opacity-50`} onClick={fechar} disabled={salvando}>Cancelar</button>
          <button type="button" onClick={confirmar} disabled={salvando}
            className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {salvando ? "Enviando…" : "Confirmar recriação"}
          </button>
        </div>
      </div>
    </div>
  );
}
