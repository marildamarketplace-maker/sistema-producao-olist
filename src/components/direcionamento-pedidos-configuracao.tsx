"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/components/auth-provider";
import { configuracaoDirecionamentoSchema, UFS_DIRECIONAMENTO, type ConfiguracaoDirecionamento, type RegraDirecionamento } from "@/lib/direcionamento-pedidos-contrato";

type Filho = { id: string; nome: string };
type Condicao = RegraDirecionamento["condicoes"][number];
const respostaSchema = z.object({ disponivel: z.boolean(), filhos: z.array(z.object({ id: z.guid(), nome: z.string() })).max(1000).optional(), configuracao: configuracaoDirecionamentoSchema.nullable().optional() });
const botao = "min-h-11 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
function condicaoNova(campo: Condicao["campo"]): Condicao {
  if (campo === "UF_EM" || campo === "UF_FORA") return { campo, ufs: ["MG"] };
  return campo === "NOME_CONTEM" ? { campo, texto: "" } : { campo, tipo: "CPF" };
}
export function DirecionamentoPedidosConfiguracao({ ativo, onDisponivel }: { ativo: boolean; onDisponivel: (valor: boolean) => void }) {
  const { session, usuario } = useAuth();
  if (!usuario || !session?.access_token) return null;
  return <EditorDirecionamento key={`${usuario.id}:${usuario.aplicativo_id}`} token={session.access_token} editar={Boolean(usuario.podeEditarConfiguracao)} ativo={ativo} onDisponivel={onDisponivel} />;
}

function EditorDirecionamento({ token, editar, ativo, onDisponivel }: { token: string; editar: boolean; ativo: boolean; onDisponivel: (valor: boolean) => void }) {
  const [filhos, setFilhos] = useState<Filho[]>([]);
  const [config, setConfig] = useState<ConfiguracaoDirecionamento | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  const [falhaCarga, setFalhaCarga] = useState(false);
  const [reload, setReload] = useState(0);
  const recargaAplicada = useRef<number | null>(null);
  const leitura = useRef<AbortController | null>(null);
  const geracao = useRef(0);
  const montado = useRef(true);
  const salvando = useRef(false);
  useEffect(() => { montado.current = true; return () => { montado.current = false; leitura.current?.abort(); }; }, []);
  useEffect(() => {
    // Renovar a credencial não substitui um rascunho do mesmo usuário/aplicativo.
    if (recargaAplicada.current === reload) return;
    const abort = new AbortController();
    leitura.current = abort;
    const atual = ++geracao.current;
    const vigente = () => !abort.signal.aborted && montado.current && atual === geracao.current;
    setLoading(true);
    setFalhaCarga(false);
    fetch("/api/olist/direcionamento", { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal, cache: "no-store" }).then(async resposta => {
      const json: unknown = await resposta.json();
      if (!resposta.ok) throw new Error("Não foi possível carregar as regras. Recarregue para tentar novamente.");
      const dados = respostaSchema.parse(json);
      if (!vigente()) return;
      recargaAplicada.current = reload;
      onDisponivel(dados.disponivel === true);
      setFilhos(dados.filhos ?? []);
      setConfig(dados.configuracao ? configuracaoDirecionamentoSchema.parse(dados.configuracao) : null);
      setMensagem(null);
    }).catch(() => { if (vigente()) { setFalhaCarga(true); setErro(true); setMensagem("Não foi possível carregar as regras. Recarregue para tentar novamente."); onDisponivel(true); } })
      .finally(() => { if (vigente()) setLoading(false); });
    return () => abort.abort();
  }, [token, reload, onDisponivel]);
  function atualizarRegra(indice: number, regra: RegraDirecionamento) {
    if (config) setConfig({ ...config, regras: config.regras.map((r, i) => i === indice ? regra : r) });
  }
  function mover(indice: number, delta: number) {
    if (!config) return;
    const regras = [...config.regras];
    [regras[indice], regras[indice + delta]] = [regras[indice + delta], regras[indice]];
    setConfig({ ...config, regras });
  }
  async function salvar() {
    if (salvando.current || !editar) return;
    const parsed = configuracaoDirecionamentoSchema.safeParse(config);
    if (!parsed.success) { setErro(true); setMensagem("Revise o padrão, os nomes e todas as condições. Cada regra precisa de ao menos uma condição válida."); return; }
    salvando.current = true;
    const atual = ++geracao.current;
    leitura.current?.abort();
    const vigente = () => montado.current && atual === geracao.current;
    setSaving(true); setLoading(false); setMensagem(null);
    try {
      const resposta = await fetch("/api/olist/direcionamento", { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const dados = await resposta.json();
      if (!vigente()) return;
      if (!resposta.ok) throw new Error(dados.error ?? "Não foi possível salvar as regras.");
      setConfig(configuracaoDirecionamentoSchema.parse(dados.configuracao)); setErro(false); setMensagem("Direcionamento salvo. Pedidos já incluídos na fila mantêm seu destino.");
    } catch (e) { if (vigente()) { setErro(true); setMensagem(e instanceof Error ? e.message : "Não foi possível salvar as regras."); } }
    finally { if (vigente()) { salvando.current = false; setSaving(false); } }
  }
  if (!ativo) return null;
  const rascunho = config ?? { versao: 0, aplicativoPadraoId: "", regras: [] };
  return <section aria-label="Direcionamento de pedidos" className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
    <h2 className="text-lg font-semibold text-slate-900">Direcionamento de pedidos</h2>
    <p className="text-sm text-slate-600">A primeira regra ativa satisfeita define o destino. A UF usada é a do endereço principal do cliente na conta de referência. Sem correspondência, vale o aplicativo padrão.</p>
    {loading ? <p role="status">Carregando regras...</p> : falhaCarga ? null : filhos.length === 0 ? <p className="text-sm">Conta única: os pedidos usam a própria conta, sem exigir regras.</p> : <form className="space-y-5" onSubmit={e => { e.preventDefault(); void salvar(); }}>
      <fieldset disabled={!editar || saving} className="min-w-0 space-y-5">
        <label className="block text-sm font-medium">Aplicativo padrão
          <select className="input mt-1 min-h-11 w-full" value={rascunho.aplicativoPadraoId} onChange={e => setConfig({ ...rascunho, aplicativoPadraoId: e.target.value })} required>
            <option value="">Selecione um aplicativo</option>{filhos.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </label>
        {rascunho.regras.map((regra, indice) => <fieldset key={regra.id} className="min-w-0 space-y-4 rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold">Prioridade {indice + 1}</legend>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={regra.ativa} onChange={e => atualizarRegra(indice, { ...regra, ativa: e.target.checked })} />Ativa</label>
            <button type="button" className={botao} disabled={indice === 0} onClick={() => mover(indice, -1)} aria-label={`Subir regra ${indice + 1}`}>Subir</button>
            <button type="button" className={botao} disabled={indice === rascunho.regras.length - 1} onClick={() => mover(indice, 1)} aria-label={`Descer regra ${indice + 1}`}>Descer</button>
            <button type="button" className={botao} onClick={() => setConfig({ ...rascunho, regras: rascunho.regras.filter(r => r.id !== regra.id) })}>Excluir regra</button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">Nome da regra<input className="input mt-1 w-full" value={regra.nome} maxLength={100} required onChange={e => atualizarRegra(indice, { ...regra, nome: e.target.value })} /></label>
            <label className="text-sm">Aplicativo destinatário<select className="input mt-1 min-h-11 w-full" value={regra.aplicativoId} onChange={e => atualizarRegra(indice, { ...regra, aplicativoId: e.target.value })}>{filhos.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></label>
          </div>
          <label className="block text-sm">Combinar condições<select className="input mt-1 min-h-11 w-full" value={regra.combinacao} onChange={e => atualizarRegra(indice, { ...regra, combinacao: e.target.value === "E" ? "E" : "OU" })}><option value="E">Todas (E)</option><option value="OU">Qualquer (OU)</option></select></label>
          {regra.condicoes.map((condicao, ci) => {
            const mudar = (nova: Condicao) => atualizarRegra(indice, { ...regra, condicoes: regra.condicoes.map((c, i) => i === ci ? nova : c) });
            return <fieldset key={ci} className="min-w-0 space-y-3 rounded-md border border-slate-200 p-3"><legend className="px-1 text-sm">Condição {ci + 1}</legend>
              <label className="block text-sm">Campo<select className="input mt-1 min-h-11 w-full" value={condicao.campo} onChange={e => { const campo = e.target.value; if (campo === "UF_EM" || campo === "UF_FORA" || campo === "NOME_CONTEM" || campo === "DOCUMENTO_TIPO") mudar(condicaoNova(campo)); }}><option value="UF_EM">UF está na lista</option><option value="UF_FORA">UF fora da lista</option><option value="NOME_CONTEM">Nome contém</option><option value="DOCUMENTO_TIPO">Documento é</option></select></label>
              {condicao.campo === "NOME_CONTEM" ? <label className="block text-sm">Texto<input className="input mt-1 w-full" value={condicao.texto} maxLength={100} required onChange={e => mudar({ ...condicao, texto: e.target.value })} /></label> : condicao.campo === "DOCUMENTO_TIPO" ? <label className="block text-sm">Tipo de documento<select className="input mt-1 min-h-11 w-full" value={condicao.tipo} onChange={e => mudar({ ...condicao, tipo: e.target.value === "CPF" ? "CPF" : "CNPJ" })}><option>CPF</option><option>CNPJ</option></select></label> : <fieldset><legend className="text-sm">Estados (selecione ao menos um)</legend><div className="mt-1 grid grid-cols-3 gap-1 sm:grid-cols-6 lg:grid-cols-9">{UFS_DIRECIONAMENTO.map(uf => <label key={uf} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={condicao.ufs.includes(uf)} onChange={e => mudar({ ...condicao, ufs: e.target.checked ? [...condicao.ufs, uf] : condicao.ufs.filter(v => v !== uf) })} />{uf}</label>)}</div></fieldset>}
              <button type="button" className={botao} disabled={regra.condicoes.length === 1} onClick={() => atualizarRegra(indice, { ...regra, condicoes: regra.condicoes.filter((_, i) => i !== ci) })}>Excluir condição</button>
            </fieldset>;
          })}
          <button type="button" className={botao} disabled={regra.condicoes.length >= 10} onClick={() => atualizarRegra(indice, { ...regra, condicoes: [...regra.condicoes, condicaoNova("UF_EM")] })}>Adicionar condição</button>
        </fieldset>)}
        <div className="flex flex-wrap gap-3">
          <button type="button" className={botao} disabled={rascunho.regras.length >= 50} onClick={() => setConfig({ ...rascunho, regras: [...rascunho.regras, { id: crypto.randomUUID(), nome: "", ativa: true, aplicativoId: rascunho.aplicativoPadraoId || filhos[0].id, combinacao: "E", condicoes: [condicaoNova("UF_EM")] }] })}>Adicionar regra</button>
          <button className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" type="submit">{saving ? "Salvando..." : "Salvar direcionamento"}</button>
        </div>
      </fieldset>
    </form>}
    {mensagem && <p role={erro ? "alert" : "status"} className={erro ? "text-sm text-red-700" : "text-sm text-slate-700"}>{mensagem}</p>}
    {!loading && <button type="button" className={botao} disabled={saving} onClick={() => setReload(v => v + 1)}>Recarregar configuração salva</button>}
  </section>;
}
