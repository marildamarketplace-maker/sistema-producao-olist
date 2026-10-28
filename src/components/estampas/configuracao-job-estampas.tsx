"use client";

import { useEffect, useRef, useState } from "react";
import type { ConfiguracaoJobEstampas } from "@/domain/configuracao-job-estampas";

export function ConfiguracaoJobEstampasPainel({ token }: { token: string }) {
  const [configuracao, setConfiguracao] = useState<ConfiguracaoJobEstampas | null>(null);
  const [pausado, setPausado] = useState(true);
  const [filtrarVariantes, setFiltrarVariantes] = useState(false);
  const [variantes, setVariantes] = useState("");
  const [termos, setTermos] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const envioAtivo = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setCarregando(true);
    setConfiguracao(null);
    setErro(null);
    void (async () => {
      try {
        const resposta = await fetch("/api/estampas/jobs/configuracao", {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
        });
        const dados = await resposta.json();
        if (!resposta.ok) throw new Error(dados.error ?? "Erro ao carregar a configuração.");
        if (controller.signal.aborted) return;
        setConfiguracao(dados);
        setFiltrarVariantes(dados.variantesPermitidas.length > 0);
        setVariantes(dados.variantesPermitidas.join("\n"));
        setPausado(dados.pausado);
        setTermos(dados.termosIgnoradosNomeArquivo.join("\n"));
      } catch (cause) {
        if (!controller.signal.aborted) setErro(cause instanceof Error ? cause.message : "Erro ao carregar a configuração.");
      } finally {
        if (!controller.signal.aborted) setCarregando(false);
      }
    })();
    return () => controller.abort();
  }, [token, tentativa]);

  async function salvar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (envioAtivo.current || !configuracao) return;
    if (filtrarVariantes && !variantes.trim()) { setErro("Informe ao menos uma variante ou selecione Sem filtro."); return; }
    envioAtivo.current = true;
    setSalvando(true); setErro(null); setMensagem(null);
    try {
      const resposta = await fetch("/api/estampas/jobs/configuracao", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ pausado, variantesPermitidas: filtrarVariantes ? variantes.split(/\r?\n/).map(v => v.trim()).filter(Boolean) : [], termosIgnoradosNomeArquivo: termos.split(/\r?\n/).map(termo => termo.trim()).filter(Boolean) }),
      });
      const dados = await resposta.json();
      if (!resposta.ok) throw new Error(dados.error ?? "Erro ao salvar a configuração.");
      setConfiguracao(dados);
        setFiltrarVariantes(dados.variantesPermitidas.length > 0);
        setVariantes(dados.variantesPermitidas.join("\n"));
      setPausado(dados.pausado);
      setTermos(dados.termosIgnoradosNomeArquivo.join("\n"));
      setMensagem("Configuração salva com sucesso.");
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : "Erro ao salvar a configuração.");
    } finally { envioAtivo.current = false; setSalvando(false); }
  }

  return <section aria-labelledby="configuracao-job-titulo" className="rounded-lg border border-slate-200 bg-white p-5">
    <h2 id="configuracao-job-titulo" className="font-semibold text-slate-900">Configuração do processamento automático</h2>
    {carregando && <p role="status" className="mt-3 text-sm text-slate-600">Carregando configuração...</p>}
    {configuracao && <form onSubmit={salvar} className="mt-4 space-y-4">
      <p className="text-sm text-slate-600">Estado salvo: <strong>{configuracao.pausado ? "Pausado" : "Ativo"}</strong></p>
      <fieldset disabled={salvando} className="grid min-w-0 gap-4 md:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <label htmlFor="execucao-job-estampas" className="block text-sm font-medium text-slate-700">Execução do job</label>
          <select id="execucao-job-estampas" className="input min-h-11 w-full" value={pausado ? "pausado" : "ativo"} onChange={e => { setPausado(e.target.value === "pausado"); setMensagem(null); }}>
            <option value="pausado">Pausado</option><option value="ativo">Ativo</option>
          </select>
          <p className="text-sm text-slate-600">Ativo permite executar no próximo ciclo agendado. Pausado impede novas análises automáticas; análises em andamento e lotes já enviados ao provedor não são cancelados.</p>
        </div>
        <div className="min-w-0 space-y-2">
          <label htmlFor="filtro-variantes" className="block text-sm font-medium text-slate-700">Variantes que podem ser processadas</label>
          <select id="filtro-variantes" className="input min-h-11" value={filtrarVariantes ? "selecionadas" : "todas"} onChange={e => { setFiltrarVariantes(e.target.value === "selecionadas"); setMensagem(null); }}>
            <option value="todas">Sem filtro de variante</option>
            <option value="selecionadas">Somente variantes informadas</option>
          </select>
          {filtrarVariantes && <>
            <label htmlFor="variantes-permitidas" className="block text-sm font-medium text-slate-700">Variantes permitidas (uma por linha)</label>
            <textarea id="variantes-permitidas" required aria-describedby="variantes-ajuda" className="input min-h-32" rows={3} value={variantes} onChange={e => { setVariantes(e.target.value); setMensagem(null); }} />
          </>}
          <p id="variantes-ajuda" className="text-sm text-slate-600">Exemplo: A para processar somente a variante A; troque por B depois. A comparação é exata, sem diferenciar maiúsculas e minúsculas. Sem filtro inclui todas, inclusive estampas sem variante. Vale no próximo ciclo automático, incluindo jobs pendentes; não cancela análises iniciadas.</p>
          <p className="text-sm text-slate-600">Filtro salvo: {configuracao.variantesPermitidas.length ? configuracao.variantesPermitidas.join(", ") : "Sem filtro"}</p>
        </div>
        <div className="min-w-0 space-y-2">
          <label htmlFor="termos-ignorados-estampas" className="block text-sm font-medium text-slate-700">Termos ignorados no nome do arquivo</label>
          <textarea id="termos-ignorados-estampas" aria-describedby="termos-ignorados-ajuda" className="input min-h-32 w-full" rows={5} value={termos} onChange={e => { setTermos(e.target.value); setMensagem(null); }} />
          <p id="termos-ignorados-ajuda" className="text-sm text-slate-600">Um termo por linha, até 100 termos de 100 caracteres. Ignora arquivos cujo nome contém o termo, sem diferenciar maiúsculas e minúsculas. Pastas e extensão não contam. O termo - ignora apenas nomes terminados em hífen. Deixe vazio para não filtrar. A alteração vale no próximo ciclo automático.</p>
        </div>
      </fieldset>
      <button disabled={salvando || carregando} className="min-h-11 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:opacity-50 sm:w-auto">{salvando ? "Salvando..." : "Salvar configuração"}</button>
    </form>}
    {erro && <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
    {!carregando && !configuracao && <button type="button" onClick={() => setTentativa(v => v + 1)} className="mt-3 min-h-11 rounded-md border border-slate-300 px-4 text-sm">Tentar novamente</button>}
    {mensagem && <p role="status" className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">{mensagem}</p>}
  </section>;
}
