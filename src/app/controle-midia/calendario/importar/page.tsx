"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { catalogoComercial } from "@/lib/calendario-comercial/catalogo";
import { lerCsvAssociacoes, type EntradaImportacao, type PreviaImportacao } from "@/lib/calendario-comercial/importacao";
import { importarLoteCalendario, validarImportacaoCalendario } from "../actions";

const botao = "inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
const nomes = new Map(catalogoComercial.map(e => [e.id, e.nome]));
function Importacao({ token }: { token: string }) {
  const [linhas, setLinhas] = useState<EntradaImportacao["linhas"]>([]);
  const [arquivo, setArquivo] = useState("");
  const [sugestoes, setSugestoes] = useState(false), [adicionais, setAdicionais] = useState(false);
  const [previa, setPrevia] = useState<PreviaImportacao | null>(null);
  const [pagina, setPagina] = useState(0);
  const [ocupado, setOcupado] = useState(false), [erro, setErro] = useState("");
  const [progresso, setProgresso] = useState(0), [total, setTotal] = useState(0), [concluido, setConcluido] = useState(false);
  const vigente = useRef(true), operando = useRef(false), credencial = useRef(token);
  const restantes = useRef<{ eventoId: string; skus: string[] }[] | null>(null);
  useEffect(() => { credencial.current = token; }, [token]);
  useEffect(() => { vigente.current = true; return () => { vigente.current = false; }; }, []);
  function invalidar() { setPrevia(null); restantes.current = null; setProgresso(0); setTotal(0); setConcluido(false); setErro(""); setPagina(0); }
  async function ler(file?: File) {
    if (operando.current) return;
    invalidar(); setLinhas([]); setArquivo(file?.name ?? "");
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setErro("O arquivo deve ter até 5 MB."); return; }
    operando.current = true; setOcupado(true);
    try {
      const bytes = await file.arrayBuffer();
      let texto: string;
      try { texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { texto = new TextDecoder("windows-1252").decode(bytes); }
      const dados = lerCsvAssociacoes(texto);
      if (vigente.current) setLinhas(dados);
    } catch (e) { if (vigente.current) setErro(e instanceof Error ? e.message : "Não foi possível ler o arquivo."); }
    finally { operando.current = false; if (vigente.current) setOcupado(false); }
  }
  async function validar() {
    if (operando.current) return;
    invalidar(); operando.current = true; setOcupado(true);
    try {
      const r = await validarImportacaoCalendario(credencial.current, { linhas, incluirSugestoes: sugestoes, incluirAdicionais: adicionais });
      if (!vigente.current) return;
      if (r.ok) setPrevia(r.previa); else setErro(r.erro);
    } catch { if (vigente.current) setErro("Não foi possível validar o arquivo. Tente novamente."); }
    finally { operando.current = false; if (vigente.current) setOcupado(false); }
  }
  async function importar() {
    if (operando.current || !previa || concluido) return;
    if (!restantes.current) {
      const grupos = new Map<string, string[]>();
      for (const v of previa.vinculos.filter(v => !v.existente)) {
        const grupo = grupos.get(v.eventoId);
        if (grupo) grupo.push(v.sku); else grupos.set(v.eventoId, [v.sku]);
      }
      restantes.current = [...grupos].sort(([a], [b]) => a.localeCompare(b)).flatMap(([eventoId, skus]) => {
        const lotes: { eventoId: string; skus: string[] }[] = [];
        for (let i = 0; i < skus.length; i += 100) lotes.push({ eventoId, skus: skus.slice(i, i + 100) });
        return lotes;
      });
      setTotal(previa.vinculos.filter(v => !v.existente).length);
    }
    operando.current = true; setOcupado(true); setErro("");
    try {
      while (restantes.current.length && vigente.current) {
        const lote = restantes.current[0];
        const r = await importarLoteCalendario(credencial.current, lote);
        if (!vigente.current) return;
        if (!r.ok) { setErro(r.erro); return; }
        restantes.current.shift(); setProgresso(p => p + r.processados);
      }
      if (vigente.current) setConcluido(true);
    } catch { if (vigente.current) setErro("Não foi possível confirmar o lote. Clique em Retomar: vínculos já salvos não serão duplicados."); }
    finally { operando.current = false; if (vigente.current) setOcupado(false); }
  }
  function modelo() {
    const url = URL.createObjectURL(new Blob(["\ufeffSKU;Evento principal ID;Eventos adicionais IDs;Tipo associacao\r\nSEU-SKU;natal;advento;Direta\r\n"], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "modelo-associacoes-calendario.csv"; a.click(); URL.revokeObjectURL(url);
  }
  const novos = previa?.vinculos.filter(v => !v.existente).length ?? 0;
  return <div className="min-w-0 space-y-5">
    <Link href="/controle-midia/calendario" className={botao}>Voltar ao calendário</Link>
    <PageHeader title="Importar associações de produtos" description="Associe SKUs do estoque local às Celebrações e temporadas. Os vínculos existentes são preservados." />
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-6" aria-label="Arquivo e critérios">
      <div className="flex flex-wrap gap-3"><button type="button" className={botao} onClick={modelo}>Baixar modelo CSV</button></div>
      <label className="block text-sm font-medium">Arquivo CSV
        <input type="file" accept=".csv,text/csv" disabled={ocupado} onChange={e => { void ler(e.target.files?.[0]); }} className="mt-2 block min-h-11 w-full min-w-0 text-sm" />
      </label>
      <p className="break-words text-xs text-slate-600">{arquivo ? `${arquivo} · ${linhas.length} registros lidos.` : "Aceita o CSV do mapeamento, UTF-8 ou Windows-1252, separado por ponto e vírgula ou vírgula. Até 5 MB e 5.000 registros."}</p>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={sugestoes} disabled={ocupado} onChange={e => { invalidar(); setSugestoes(e.target.checked); }} />Incluir sugestões comerciais do evento principal</label>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={adicionais} disabled={ocupado} onChange={e => { invalidar(); setAdicionais(e.target.checked); }} />Incluir eventos adicionais do CSV</label>
      <p className="text-xs text-slate-600">Registros sem evento principal são ignorados. Apenas produtos ativos do aplicativo atual podem ser associados. A prévia não salva alterações.</p>
      <button type="button" className={botao} disabled={ocupado || !linhas.length || !token} onClick={() => { void validar(); }}>Validar CSV</button>
      <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Consultar IDs de eventos</summary><ul className="space-y-2 text-xs">{catalogoComercial.map(e => <li key={e.id} className="break-words"><code>{e.id}</code> · {e.nome}</li>)}</ul></details>
    </section>
    {erro && <p role="alert" className="rounded-md border border-red-200 bg-white p-4 text-sm text-red-700">{erro}</p>}
    {ocupado && <p role="status" className="text-sm text-slate-600">{total ? `Importando: ${progresso} de ${total} vínculos confirmados.` : "Lendo e validando os dados..."}</p>}
    {previa && <section className="min-w-0 space-y-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-6" aria-label="Prévia da importação">
      <h3 className="text-lg font-semibold">Prévia</h3>
      <p className="text-sm">{novos} vínculos novos · {previa.vinculos.length - novos} já associados · {previa.ignorados} registros ignorados pelas regras · {previa.duplicados} vínculos repetidos no arquivo · {previa.totalProblemas} problemas.</p>
      {previa.totalProblemas > 0 && <details open><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-amber-700">Problemas encontrados: SKUs ou eventos inválidos serão ignorados (até 100)</summary>
        <ul className="space-y-2 text-xs">{previa.problemas.map((p, i) => <li key={i} className="break-words">Registro {p.registro} · {p.sku || "Sem SKU"} · {p.motivo}</li>)}</ul></details>}
      {previa.vinculos.length > 0 && <><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th scope="col" className="p-3">SKU</th><th scope="col" className="p-3">Evento</th><th scope="col" className="p-3">Situação na validação</th></tr></thead>
        <tbody>{previa.vinculos.slice(pagina * 20, (pagina + 1) * 20).map(v => <tr key={`${v.sku}:${v.eventoId}`} className="border-t border-slate-200"><td className="break-all p-3">{v.sku}</td><td className="p-3">{nomes.get(v.eventoId)}</td><td className="p-3">{v.existente ? "Já associado" : "Novo vínculo"}</td></tr>)}</tbody></table></div>
        <nav aria-label="Páginas da prévia" className="flex flex-wrap items-center justify-between gap-3"><button type="button" className={botao} disabled={pagina === 0} onClick={() => setPagina(p => p - 1)}>Anterior</button><span className="text-xs">Página {pagina + 1} de {Math.ceil(previa.vinculos.length / 20)}</span><button type="button" className={botao} disabled={(pagina + 1) * 20 >= previa.vinculos.length} onClick={() => setPagina(p => p + 1)}>Próxima</button></nav></>}
      {!concluido && <><p className="text-xs text-slate-600">Ao confirmar, somente os vínculos válidos novos serão incluídos, em lotes de até 100. Não feche a tela durante a importação. Se fechar, reenvie e valide o mesmo CSV para identificar o que falta, sem duplicar.</p>
        <button type="button" className={`${botao} bg-slate-900 text-white`} disabled={ocupado || !novos || !token} onClick={() => { void importar(); }}>{progresso || restantes.current ? "Retomar importação" : `Importar ${novos} vínculos válidos`}</button></>}
      {concluido && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">Importação concluída: {progresso} vínculos confirmados. Os vínculos anteriores foram preservados.</p>}
    </section>}
  </div>;
}
export default function ImportacaoPage() {
  const { session, usuario } = useAuth();
  return <AccessGuard permissions={["podeVisualizarTarefasMidia"]}><Importacao key={JSON.stringify([session?.user?.id, usuario?.id, usuario?.aplicativo_id])} token={session?.access_token ?? ""} /></AccessGuard>;
}
