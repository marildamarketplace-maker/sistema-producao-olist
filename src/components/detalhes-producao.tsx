"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, Camera, Download } from "lucide-react";
import { PageHeader } from "./page-header";
import type { DetalheProducao } from "@/lib/producao-detalhes-contrato";

type Props = {
  producao: DetalheProducao;
  fotoUrl: string | null;
  carregandoFoto: boolean;
  erroFoto: string | null;
  onCarregarFoto: () => void;
  onEditar?: () => void;
  editorItens?: ReactNode;
};

const statusRotulos: Record<string, string> = {
  pendente: "Pendente", em_producao: "Em produção", concluida: "Concluída", cancelada: "Cancelada",
};

function dataHora(valor: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(valor));
}

function ImagemItem({ item }: { item: DetalheProducao["itens"][number] }) {
  return item.imagemUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={item.imagemUrl} alt={`Produto ${item.sku}`} loading="lazy" className="h-16 w-16 shrink-0 rounded-md border border-slate-200 object-contain" />
  ) : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-slate-100 p-1 text-center text-xs text-slate-500">Sem imagem</span>;
}

export function DetalhesProducao({ producao, fotoUrl, carregandoFoto, erroFoto, onCarregarFoto, onEditar, editorItens }: Props) {
  const entrega = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${producao.dataEntrega}T00:00:00Z`));
  const solicitada = producao.itens.reduce((total, item) => total + item.quantidadeSolicitada, 0);
  const produzida = producao.itens.reduce((total, item) => total + item.quantidadeProduzida, 0);
  return (
    <div className="min-w-0 space-y-6">
      <nav aria-label="Navegação estrutural" className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <Link href="/solicitacoes-producao" className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 underline underline-offset-4 focus-visible:outline focus-visible:outline-2"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Anotar produção</Link>
        <span aria-hidden="true">/</span><span aria-current="page">Detalhes da produção</span>
      </nav>
      <PageHeader title="Detalhes da produção" description={`Solicitação com entrega prevista para ${entrega}.`} />
      <section aria-label="Resumo da produção" className="grid grid-cols-3 gap-3 sm:gap-4">
        {[["Itens", producao.itens.length], ["Solicitada", solicitada], ["Produzida", produzida]].map(([rotulo, valor]) => (
          <div key={rotulo} className="min-w-0 rounded-lg border border-slate-200 bg-white p-3 sm:p-5"><p className="text-xs text-slate-600 sm:text-sm">{rotulo}</p><p className="mt-1 break-all text-2xl font-semibold text-slate-900">{Number(valor).toLocaleString("pt-BR")}</p></div>
        ))}
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="dados-producao">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h3 id="dados-producao" className="text-lg font-semibold text-slate-900">Dados da solicitação</h3>
          <div className="flex flex-wrap gap-2">
            {producao.prioridadeProducao && <span className="rounded-md bg-red-50 px-3 py-1 text-sm font-semibold text-red-700">Prioridade</span>}
            <span className={`rounded-md px-3 py-1 text-sm font-medium ${producao.status === "concluida" ? "bg-emerald-50 text-emerald-700 dark:text-emerald-300" : "bg-slate-100 text-slate-700"}`}>{statusRotulos[producao.status] ?? producao.status.replaceAll("_", " ")}</span>
          </div>
        </div>
        <dl className="grid min-w-0 gap-5 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Data de entrega</dt><dd className="mt-1 font-medium text-slate-900">{entrega}</dd></div>
          <div><dt className="text-slate-500">Data de criação · horário de Brasília</dt><dd className="mt-1 text-slate-900">{dataHora(producao.createdAt)}</dd></div>
          <div className="min-w-0 sm:col-span-2"><dt className="text-slate-500">ID da produção</dt><dd className="mt-1 break-all text-slate-900">{producao.id}</dd></div>
          {(producao.periodoInicio || producao.periodoFim) && <div className="sm:col-span-2"><dt className="text-slate-500">Período dos pedidos Olist · horário de Brasília</dt><dd className="mt-1 text-slate-900">{producao.periodoInicio ? dataHora(producao.periodoInicio) : "Não informado"} até {producao.periodoFim ? dataHora(producao.periodoFim) : "Não informado"}</dd></div>}
          <div className="min-w-0 sm:col-span-2"><dt className="text-slate-500">Observação geral</dt><dd className="mt-1 whitespace-pre-wrap break-words text-slate-900">{producao.observacaoGeral || "Nenhuma observação informada."}</dd></div>
        </dl>
      </section>
      <section aria-labelledby="pedidos-olist" className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
        <h3 id="pedidos-olist" className="text-lg font-semibold text-slate-900">Pedidos Olist vinculados</h3>
        {producao.pedidosOlist.length === 0 ? <p className="mt-3 text-sm text-slate-600">Nenhum pedido Olist vinculado.</p> : <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {producao.pedidosOlist.map((pedido, index) => <li key={`${pedido.id}-${index}`} className="min-w-0 rounded-md border border-slate-200 p-3 text-sm"><p className="break-all font-medium text-slate-900">ID pedido Olist: {pedido.id}</p><p className="mt-1 break-words text-slate-600">Fornecedor: {pedido.fornecedor}</p></li>)}
        </ul>}
      </section>
      <section aria-labelledby="itens-producao" className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 id="itens-producao" className="text-lg font-semibold text-slate-900">Itens da produção</h3>{onEditar && <button type="button" onClick={onEditar} className="min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 focus-visible:outline focus-visible:outline-2">Editar itens e quantidades</button>}</div>
        {editorItens ?? (producao.itens.length === 0 ? <p className="text-sm text-slate-600">Nenhum item cadastrado nesta solicitação.</p> : <>
          <div className="space-y-4 sm:hidden">
            {producao.itens.map((item) => <article key={item.id} className="min-w-0 rounded-md border border-slate-200 p-3">
              <div className="flex items-start gap-3"><ImagemItem item={item} /><h4 className="min-w-0 break-all text-sm font-semibold text-slate-900">{item.sku}</h4></div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-slate-500">Solicitada</dt><dd className="mt-1 font-medium text-slate-900">{item.quantidadeSolicitada}</dd></div>
                <div><dt className="text-slate-500">Produzida</dt><dd className="mt-1 font-medium text-slate-900">{item.quantidadeProduzida}</dd></div>
                <div className="col-span-2"><dt className="text-slate-500">Corte a laser</dt><dd className="mt-1 text-slate-900">{item.tipoCorte === "LASER" ? "Sim" : "Não"}</dd></div>
                <div className="col-span-2 min-w-0"><dt className="text-slate-500">Observação</dt><dd className="mt-1 whitespace-pre-wrap break-words text-slate-900">{item.observacao || "Nenhuma observação."}</dd></div>
              </dl>
            </article>)}
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="min-w-full border-collapse text-sm"><thead><tr className="border-b border-slate-200 text-left text-slate-600">{["Produto", "SKU", "Solicitada", "Produzida", "Corte a laser", "Observação"].map((rotulo) => <th key={rotulo} scope="col" className="p-3">{rotulo}</th>)}</tr></thead><tbody>
              {producao.itens.map((item) => <tr key={item.id} className="border-b border-slate-100 text-slate-700"><td className="p-3"><ImagemItem item={item} /></td><td className="min-w-48 break-all p-3 font-medium">{item.sku}</td><td className="p-3">{item.quantidadeSolicitada}</td><td className="p-3">{item.quantidadeProduzida}</td><td className="p-3">{item.tipoCorte === "LASER" ? "Sim" : "Não"}</td><td className="min-w-48 whitespace-pre-wrap break-words p-3">{item.observacao || "—"}</td></tr>)}
            </tbody></table>
          </div>
        </>)}
      </section>
      <section aria-labelledby="evidencia-producao" className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
        <h3 id="evidencia-producao" className="text-lg font-semibold text-slate-900">Evidência da confirmação</h3>
        {!producao.evidenciaDisponivel ? <p className="mt-3 text-sm text-slate-600">Nenhuma foto de evidência registrada para esta produção.</p> : <div className="mt-4 space-y-4">
          {!fotoUrl && <button type="button" onClick={onCarregarFoto} disabled={carregandoFoto} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"><Camera className="h-4 w-4" aria-hidden="true" />{carregandoFoto ? "Carregando foto..." : "Ver foto da evidência"}</button>}
          {carregandoFoto && <p role="status" className="text-sm text-slate-600">Carregando evidência...</p>}
          {erroFoto && <p role="alert" className="text-sm text-red-700">{erroFoto}</p>}
          {fotoUrl && <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fotoUrl} alt="Foto do pedido em papel usada como evidência da confirmação de produção" className="max-h-[70vh] w-full rounded-md border border-slate-200 object-contain" />
            <a href={fotoUrl} download={`evidencia-producao-${producao.id}.jpg`} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 focus-visible:outline focus-visible:outline-2"><Download className="h-4 w-4" aria-hidden="true" />Baixar foto</a>
          </>}
        </div>}
      </section>
    </div>
  );
}
