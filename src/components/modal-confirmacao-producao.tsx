"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Check, LoaderCircle, LockKeyhole, X } from "lucide-react";
import { prepararFotoProducao } from "@/lib/preparar-foto-producao";

type Props = {
  dataEntregaFormatada: string;
  senha: string;
  confirmando: boolean;
  erroModal: string | null;
  onSenhaChange: (senha: string) => void;
  onFechar: () => void;
  onConfirmar: (foto: File) => void;
};

export function ModalConfirmacaoProducao({ dataEntregaFormatada, senha, confirmando, erroModal, onSenhaChange, onFechar, onConfirmar }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galeriaRef = useRef<HTMLInputElement>(null);
  const senhaRef = useRef<HTMLInputElement>(null);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const selecaoAtual = useRef({ id: 0, ativa: true });
  const [etapa, setEtapa] = useState<"foto" | "senha">("foto");
  const [foto, setFoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [erroFoto, setErroFoto] = useState<string | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const controleSelecao = selecaoAtual.current;
    controleSelecao.ativa = true;
    const focoAnterior = document.activeElement;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => {
      controleSelecao.ativa = false;
      controleSelecao.id++;
      dialog?.close();
      document.body.style.overflow = overflowAnterior;
      if (focoAnterior instanceof HTMLElement && focoAnterior.isConnected) focoAnterior.focus();
    };
  }, []);

  useEffect(() => {
    if (!foto) { setPreview(null); return; }
    const url = URL.createObjectURL(foto);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [foto]);

  useEffect(() => {
    if (etapa === "senha") senhaRef.current?.focus();
    else tituloRef.current?.focus();
  }, [etapa]);

  async function selecionarFoto(arquivo?: File) {
    if (!arquivo) return;
    const controle = selecaoAtual.current;
    const selecao = ++controle.id;
    setPreparando(true);
    setErroFoto(null);
    setFoto(null);
    try {
      const preparada = await prepararFotoProducao(arquivo);
      if (controle.ativa && selecao === controle.id) setFoto(preparada);
    } catch (error) {
      if (controle.ativa && selecao === controle.id) setErroFoto(error instanceof Error ? error.message : "Não foi possível preparar a foto.");
    } finally {
      if (controle.ativa && selecao === controle.id) setPreparando(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="titulo-modal-confirmacao"
      aria-describedby="descricao-modal-confirmacao"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        if (!confirmando) onFechar();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 backdrop:bg-slate-950/60 backdrop:backdrop-blur-sm"
    >
      <div className="flex min-h-full items-end sm:items-center sm:justify-center sm:p-4">
        <div className="max-h-dvh w-full overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-slate-900 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:max-w-md sm:rounded-3xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                  {etapa === "foto" ? <Camera className="h-5 w-5" aria-hidden="true" /> : <LockKeyhole className="h-5 w-5" aria-hidden="true" />}
                </span>
                <p className="mt-3 text-xs font-medium text-slate-500">Etapa {etapa === "foto" ? "1" : "2"} de 2</p>
                <h2 ref={tituloRef} tabIndex={-1} id="titulo-modal-confirmacao" className="mt-1 text-xl font-bold">{etapa === "foto" ? "Foto do pedido em papel" : "Autorizar confirmação"}</h2>
                <p id="descricao-modal-confirmacao" className="mt-1 text-sm text-slate-600">
                  {etapa === "foto" ? `Fotografe o pedido em papel da entrega de ${dataEntregaFormatada}. Confira se os dados estão legíveis.` : `Digite a senha para confirmar a entrega de ${dataEntregaFormatada} e enviar a evidência.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onFechar()}
                disabled={confirmando}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {etapa === "foto" ? (
              <div className="mt-5 space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button type="button" disabled={preparando} onClick={() => cameraRef.current?.click()} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 disabled:opacity-60"><Camera className="h-5 w-5" aria-hidden="true" />Tirar foto</button>
                  <button type="button" disabled={preparando} onClick={() => galeriaRef.current?.click()} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 disabled:opacity-60"><ImagePlus className="h-5 w-5" aria-hidden="true" />Selecionar da galeria</button>
                </div>
                <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(event) => { void selecionarFoto(event.target.files?.[0]); event.target.value = ""; }} />
                <input ref={galeriaRef} hidden type="file" accept="image/*" onChange={(event) => { void selecionarFoto(event.target.files?.[0]); event.target.value = ""; }} />
                {preparando && <p role="status" className="text-sm text-slate-600">Preparando foto...</p>}
                {preview && (
                  <div className="rounded-xl border border-slate-200 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={preview} alt="Prévia da evidência do pedido em papel" className="max-h-72 w-full rounded-lg object-contain" />
                    <p className="mt-2 text-sm text-slate-600">Confira a leitura do papel. Para trocar a foto, use os botões acima.</p>
                  </div>
                )}
                {erroFoto && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{erroFoto}</p>}
                <button type="button" disabled={!foto || preparando} onClick={() => setEtapa("senha")} className="min-h-12 w-full rounded-2xl bg-slate-950 px-4 py-3 text-base font-bold text-white disabled:opacity-60">Continuar para senha</button>
              </div>
            ) : <form
              className="mt-5"
              onSubmit={(event) => {
                event.preventDefault();
                if (!confirmando && foto) onConfirmar(foto);
              }}
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
                <span className="text-sm text-slate-600">Foto do pedido anexada</span>
                <button type="button" disabled={confirmando} onClick={() => { onSenhaChange(""); setEtapa("foto"); }} className="min-h-11 rounded-md px-3 py-2 text-sm font-medium underline disabled:opacity-60">Revisar foto</button>
              </div>
              <label className="block text-sm font-semibold text-slate-800">
                Senha
                <input
                  ref={senhaRef}
                  type="password"
                  autoComplete="current-password"
                  value={senha}
                  onChange={(event) => onSenhaChange(event.target.value)}
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
                {confirmando ? "Enviando foto e confirmando..." : "Confirmar entrega"}
              </button>
              {confirmando && <p role="status" className="mt-2 text-sm text-slate-600">Aguarde o envio da foto e a confirmação.</p>}
            </form>}
        </div>
      </div>
    </dialog>
  );
}
