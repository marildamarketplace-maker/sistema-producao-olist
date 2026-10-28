"use client";

import { useState } from "react";
import { lerLoteKits, type ComposicaoKit } from "@/lib/importar-kits-estoque";

const botao = "min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50";
const modelo = "sku_kit;sku_componente;quantidade\nKIT-EXEMPLO;SKU-INDIVIDUAL-A;1\nKIT-EXEMPLO;SKU-INDIVIDUAL-B;2\n";

export function ImportarKitsEstoque({ ocupada, existentes, importar }: {
  ocupada: boolean;
  existentes: readonly string[];
  importar: (kits: ComposicaoKit[]) => Promise<void>;
}) {
  const [texto, setTexto] = useState("");
  const [previa, setPrevia] = useState<ComposicaoKit[]>([]);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [lendo, setLendo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const bloqueada = ocupada || lendo || salvando;
  function alterarTexto(valor: string) {
    setTexto(valor); setPrevia([]); setErro(""); setMensagem("");
  }
  async function lerArquivo(arquivo?: File) {
    if (!arquivo) return;
    setPrevia([]); setMensagem(""); setErro(""); setLendo(true);
    try {
      if (arquivo.size > 1_000_000) throw new Error("O arquivo deve ter no máximo 1 MB.");
      alterarTexto(await arquivo.text());
    } catch (error) { setErro(error instanceof Error ? error.message : "Não foi possível ler o arquivo."); }
    finally { setLendo(false); }
  }
  async function confirmar() {
    if (bloqueada || !previa.length) return;
    setSalvando(true); setErro(""); setMensagem("");
    try {
      await importar(previa);
      setMensagem(`${previa.length} kits importados com sucesso.`); setPrevia([]);
    } catch (error) { setErro(error instanceof Error ? error.message : "Erro ao importar. Tente novamente."); }
    finally { setSalvando(false); }
  }
  return <section className="min-w-0 space-y-4 rounded-lg border border-slate-200 bg-white p-5" aria-labelledby="importar-kits-titulo">
    <h3 id="importar-kits-titulo" className="font-semibold">Importar associações em lote</h3>
    <p className="text-sm text-slate-600">Uma linha por componente: SKU do kit, SKU individual e quantidade por kit. Use ponto e vírgula, vírgula ou tabulação. Limite de 500 kits e 2000 componentes.</p>
    <a className="inline-flex min-h-11 items-center rounded-md px-3 text-sm underline focus-visible:ring-2 focus-visible:ring-slate-400" download="modelo-associacao-kits.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(modelo)}`}>Baixar modelo CSV</a>
    <fieldset disabled={bloqueada} className="min-w-0 space-y-4">
      <label className="block min-w-0 text-sm font-medium">Carregar arquivo CSV ou TXT
        <input type="file" accept=".csv,.txt,text/csv,text/plain" className="mt-1 block min-h-11 w-full min-w-0 max-w-full text-sm file:mr-2 file:min-h-11 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:text-slate-700" onChange={(event) => { void lerArquivo(event.target.files?.[0]); event.target.value = ""; }} />
      </label>
      <label className="block text-sm font-medium">Dados para importar
        <textarea className="input mt-1 min-h-48 w-full font-mono" value={texto} maxLength={1_000_000} placeholder={modelo} onChange={(event) => alterarTexto(event.target.value)} aria-describedby="importar-kits-ajuda" />
      </label>
      <p id="importar-kits-ajuda" className="text-sm text-slate-600">Cada kit importado terá sua composição inteira substituída pelas linhas informadas. Kits ausentes do lote serão mantidos. A alteração vale para próximas baixas e gerações de produção.</p>
      <button type="button" className={botao} disabled={!texto.trim()} onClick={() => {
        setErro(""); setMensagem(""); setPrevia([]);
        try { setPrevia(lerLoteKits(texto)); }
        catch (error) { setErro(error instanceof Error ? error.message : "Dados inválidos."); }
      }}>Conferir importação</button>
    </fieldset>
    {lendo && <p role="status" className="text-sm">Lendo arquivo…</p>}
    {erro && <p role="alert" className="break-words rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
    {mensagem && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{mensagem}</p>}
    {previa.length > 0 && <div className="space-y-4">
      <p role="status" className="text-sm font-medium">Prévia: {previa.length} kits, {previa.reduce((total, kit) => total + kit.componentes.length, 0)} componentes. A existência dos produtos será validada ao confirmar.</p>
      <div className="max-h-96 space-y-3 overflow-y-auto rounded-md border border-slate-200 p-3" tabIndex={0} aria-label="Composições que serão importadas">
        {previa.map((kit) => <article key={kit.sku} className="space-y-2 border-b border-slate-200 pb-3 text-sm">
          <h4 className="break-all font-medium">{kit.sku}</h4>
          <p className="text-slate-600">{existentes.includes(kit.sku) ? "Substituir composição existente" : "Criar associação"}</p>
          <ul className="space-y-1 text-slate-600">{kit.componentes.map((item) => <li key={item.sku} className="break-all">{item.quantidade} × {item.sku}</li>)}</ul>
        </article>)}
      </div>
      <button type="button" disabled={bloqueada} className={`${botao} bg-slate-900 text-white`} onClick={() => void confirmar()}>{salvando ? "Importando…" : "Confirmar importação do lote"}</button>
    </div>}
  </section>;
}
