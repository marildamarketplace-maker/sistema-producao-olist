"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { conterFocoNoDialogo } from "@/lib/dialogo-foco";
import { permissionKeys, permissionLabels, type PermissionKey, type PermissionSet } from "@/lib/permissions";
import type { EntradaVendedorOlist } from "@/lib/usuario-vendedor-olist";

type UsuarioResumo = {
  id: string; nome: string; email: string; ativo: boolean; vendedorOlistId: number | null;
  vendedoresOlistQuantidade: number; vinculosOlistVersao: number;
};
type UsuarioDetalhe = UsuarioResumo & PermissionSet & { vendedoresOlist: EntradaVendedorOlist[] };
type AplicativoOpcao = { id: string; nome: string };
type VinculoEdicao = { aplicativoId: string; vendedorOlistId: string };
type Paginacao = { pagina: number; limite: number; total: number; totalPaginas: number };
type FeedbackEdicao = { usuarioId: string; tipo: "erro" | "sucesso"; mensagem: string };
const botao = "min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
const primario = "min-h-11 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
const permissoesVazias = () => Object.fromEntries(permissionKeys.map((permission) => [permission, false])) as PermissionSet;
const serializarVinculos = (vinculos: VinculoEdicao[]): EntradaVendedorOlist[] => vinculos.map((vinculo) => ({ aplicativoId: vinculo.aplicativoId, vendedorOlistId: Number(vinculo.vendedorOlistId) }));

function VendedoresDoUsuario({ vinculos, aplicativos, carregando, disabled, aoAlterar }: {
  vinculos: VinculoEdicao[]; aplicativos: AplicativoOpcao[] | null; carregando: boolean; disabled: boolean;
  aoAlterar: (vinculos: VinculoEdicao[]) => void;
}) {
  return <fieldset disabled={disabled} className="min-w-0 space-y-3 rounded-md border border-slate-200 p-4">
    <legend className="px-1 text-sm font-semibold text-slate-900">Vendedores Olist por aplicativo</legend>
    <p className="text-sm text-slate-600">Cadastre o ID correspondente a cada conta para sugerir o vendedor nos pedidos. Você pode vincular o aplicativo próprio e seus filhos.</p>
    {carregando && <p role="status" className="text-sm text-slate-600">Carregando aplicativos...</p>}
    {!vinculos.length && <p className="text-sm text-slate-500">Nenhum vendedor vinculado.</p>}
    {vinculos.map((vinculo, indice) => <div key={indice} className="grid min-w-0 gap-3 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <label className="min-w-0 text-sm text-slate-700">Aplicativo<select required className="input mt-1 min-h-11 w-full min-w-0" value={vinculo.aplicativoId} disabled={carregando} onChange={(event) => aoAlterar(vinculos.map((atual, posicao) => posicao === indice ? { ...atual, aplicativoId: event.target.value } : atual))}>
        <option value="">Selecione o aplicativo</option>
        {vinculo.aplicativoId && !aplicativos?.some((app) => app.id === vinculo.aplicativoId) && <option value={vinculo.aplicativoId}>Aplicativo indisponível — remova este vínculo</option>}
        {aplicativos?.map((app) => <option key={app.id} value={app.id} disabled={vinculos.some((outro, posicao) => posicao !== indice && outro.aplicativoId === app.id)}>{app.nome}</option>)}
      </select></label>
      <label className="min-w-0 text-sm text-slate-700">ID vendedor Olist<input required inputMode="numeric" pattern="[0-9]+" maxLength={10} className="input mt-1 min-h-11 w-full" value={vinculo.vendedorOlistId} onChange={(event) => aoAlterar(vinculos.map((atual, posicao) => posicao === indice ? { ...atual, vendedorOlistId: event.target.value.replace(/\D/g, "") } : atual))} /></label>
      <button type="button" className={botao} aria-label={`Remover vínculo ${indice + 1}`} onClick={() => aoAlterar(vinculos.filter((_, posicao) => posicao !== indice))}>Remover</button>
    </div>)}
    <button type="button" className={botao} disabled={carregando || !aplicativos || vinculos.length >= aplicativos.length || vinculos.length >= 1000} onClick={() => aoAlterar([...vinculos, { aplicativoId: "", vendedorOlistId: "" }])}>Adicionar vendedor</button>
  </fieldset>;
}

function PermissoesUsuario({ permissoes, disabled, aoAlterar }: { permissoes: PermissionSet; disabled: boolean; aoAlterar: (permission: PermissionKey, value: boolean) => void }) {
  return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{permissionKeys.map((permission) => <label key={permission} className="flex min-h-11 items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
    <input type="checkbox" disabled={disabled} checked={permissoes[permission]} onChange={(event) => aoAlterar(permission, event.target.checked)} />{permissionLabels[permission]}
  </label>)}</div>;
}

function UsuariosPage() {
  const { session, usuario: usuarioLogado } = useAuth();
  const token = session?.access_token;
  const escopo = `${usuarioLogado?.id ?? ""}:${usuarioLogado?.aplicativo_id ?? ""}`;
  const [escopoCache, setEscopoCache] = useState(escopo);
  const revisaoEscopo = useRef(0);
  const searchParams = useSearchParams();
  const [usuarios, setUsuarios] = useState<UsuarioResumo[]>([]);
  const [detalhes, setDetalhes] = useState<Record<string, UsuarioDetalhe>>({});
  const [aplicativos, setAplicativos] = useState<AplicativoOpcao[] | null>(null);
  const [carregandoAplicativos, setCarregandoAplicativos] = useState(false);
  const aplicativosRequest = useRef<{ escopo: string; promessa: Promise<AplicativoOpcao[]> } | null>(null);
  const [pagina, setPagina] = useState(1);
  const [paginacao, setPaginacao] = useState<Paginacao>({ pagina: 1, limite: 50, total: 0, totalPaginas: 1 });
  const [formAberto, setFormAberto] = useState(false);
  const [form, setForm] = useState({ nome: "", email: "", senha: "" });
  const [vinculosNovos, setVinculosNovos] = useState<VinculoEdicao[]>([]);
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [permissoesNovo, setPermissoesNovo] = useState<PermissionSet>(permissoesVazias);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [edicao, setEdicao] = useState({ nome: "", email: "", ativo: true, vinculosOlistVersao: 0 });
  const [vinculosEdicao, setVinculosEdicao] = useState<VinculoEdicao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [feedbackEdicao, setFeedbackEdicao] = useState<FeedbackEdicao | null>(null);
  const dialogo = useRef<HTMLDialogElement>(null);
  const carregamento = useRef(0);
  const detalheRequest = useRef(0);
  const salvamento = useRef(false);
  const formularioErro = useRef<HTMLParagraphElement>(null);
  const criarBotao = useRef<HTMLButtonElement>(null);
  const feedbackEdicaoRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    revisaoEscopo.current++;
    carregamento.current++; detalheRequest.current++;
    aplicativosRequest.current = null; salvamento.current = false;
    setEscopoCache(escopo); setUsuarios([]); setDetalhes({}); setAplicativos(null);
    setCarregandoAplicativos(false); setPagina(1); setExpandido(null); setEditando(null);
    setFormAberto(false); setForm({ nome: "", email: "", senha: "" });
    setVinculosNovos([]); setVinculosEdicao([]); setPermissoesNovo(permissoesVazias());
    setSalvando(null); setCarregandoDetalhe(null); setErro(null); setMensagem(null); setFeedbackEdicao(null);
  }, [escopo]);

  useEffect(() => {
    if (!feedbackEdicao) return;
    const elemento = feedbackEdicaoRef.current;
    elemento?.focus({ preventScroll: true });
    elemento?.scrollIntoView({ block: "center" });
  }, [feedbackEdicao]);

  const carregar = useCallback(async (signal?: AbortSignal) => {
    if (!token) return;
    const revisao = ++carregamento.current;
    const origem = revisaoEscopo.current;
    setCarregando(true); setErro(null);
    try {
      const response = await fetch(`/api/usuarios?pagina=${pagina}&limite=50`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal });
      const json = await response.json() as { usuarios?: UsuarioResumo[]; paginacao?: Paginacao; error?: string };
      if (!response.ok || !json.paginacao) throw new Error(json.error ?? "Não foi possível carregar os usuários.");
      if (signal?.aborted || origem !== revisaoEscopo.current || revisao !== carregamento.current) return;
      if (pagina > json.paginacao.totalPaginas) { setPagina(json.paginacao.totalPaginas); return; }
      setUsuarios(json.usuarios ?? []); setPaginacao(json.paginacao);
    } catch (error) { if (!signal?.aborted && origem === revisaoEscopo.current && revisao === carregamento.current) setErro(error instanceof Error ? error.message : "Erro inesperado."); }
    finally { if (!signal?.aborted && origem === revisaoEscopo.current && revisao === carregamento.current) setCarregando(false); }
  }, [token, pagina]);
  useEffect(() => { const controller = new AbortController(); void carregar(controller.signal); return () => controller.abort(); }, [carregar, escopo]);

  const carregarAplicativos = useCallback(async () => {
    if (aplicativos && escopoCache === escopo) return aplicativos;
    if (aplicativosRequest.current?.escopo === escopo) return aplicativosRequest.current.promessa;
    if (!token) return [];
    const origem = revisaoEscopo.current;
    setCarregandoAplicativos(true);
    const consulta = (async () => {
      try {
        const response = await fetch("/api/usuarios?recurso=aplicativos", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const json = await response.json() as { aplicativos?: AplicativoOpcao[]; error?: string };
        if (!response.ok || !json.aplicativos) throw new Error(json.error ?? "Não foi possível carregar os aplicativos.");
        if (origem !== revisaoEscopo.current) return [];
        setAplicativos(json.aplicativos); return json.aplicativos;
      } finally {
        if (origem === revisaoEscopo.current) { setCarregandoAplicativos(false); aplicativosRequest.current = null; }
      }
    })();
    aplicativosRequest.current = { escopo, promessa: consulta };
    return consulta;
  }, [aplicativos, token, escopo, escopoCache]);

  useEffect(() => {
    if (searchParams.get("novo") !== "1" || !usuarioLogado?.aplicativo_id) return;
    const vendedorId = searchParams.get("vendedorOlistId")?.replace(/\D/g, "") ?? "";
    setForm({ nome: searchParams.get("nome")?.trim() ?? "", email: searchParams.get("email")?.trim() ?? "", senha: "" });
    setVinculosNovos(vendedorId ? [{ aplicativoId: usuarioLogado.aplicativo_id, vendedorOlistId: vendedorId }] : []);
    setFormAberto(true);
  }, [searchParams, usuarioLogado?.aplicativo_id]);
  useEffect(() => {
    if (!formAberto) return;
    const elemento = dialogo.current;
    const anterior = document.activeElement;
    const botaoAnterior = criarBotao.current;
    elemento?.showModal(); elemento?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { elemento?.close(); if (anterior instanceof HTMLElement && anterior.isConnected) anterior.focus(); else botaoAnterior?.focus(); };
  }, [formAberto]);
  useEffect(() => {
    if (!formAberto) return;
    const origem = revisaoEscopo.current;
    void carregarAplicativos().catch((error: unknown) => {
      if (origem === revisaoEscopo.current) setErro(error instanceof Error ? error.message : "Não foi possível carregar os aplicativos.");
    });
  }, [formAberto, carregarAplicativos]);
  useEffect(() => { if (erro && formAberto) formularioErro.current?.focus(); }, [erro, formAberto]);

  async function buscarDetalhe(usuarioId: string) {
    if (!token) throw new Error("Sessão expirada.");
    const origem = revisaoEscopo.current;
    const response = await fetch(`/api/usuarios?usuarioId=${encodeURIComponent(usuarioId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const json = await response.json() as { usuario?: UsuarioDetalhe; error?: string };
    if (!response.ok || !json.usuario) throw new Error(json.error ?? "Não foi possível carregar o usuário.");
    if (origem !== revisaoEscopo.current) throw new DOMException("Consulta cancelada.", "AbortError");
    const usuario = json.usuario;
    setDetalhes((atuais) => ({ ...atuais, [usuarioId]: usuario }));
    return usuario;
  }
  async function recarregarDetalhe(usuarioId: string) {
    const revisao = ++detalheRequest.current;
    const origem = revisaoEscopo.current;
    setCarregandoDetalhe(usuarioId); setErro(null);
    try { await buscarDetalhe(usuarioId); }
    catch (error) { if (origem === revisaoEscopo.current && revisao === detalheRequest.current) setErro(error instanceof Error ? error.message : "Erro inesperado."); }
    finally { if (origem === revisaoEscopo.current && revisao === detalheRequest.current) setCarregandoDetalhe(null); }
  }
  async function expandir(usuario: UsuarioResumo) {
    if (expandido === usuario.id) { setExpandido(null); return; }
    setExpandido(usuario.id); setEditando(null); setErro(null); setFeedbackEdicao(null);
    if (detalhes[usuario.id]) return;
    await recarregarDetalhe(usuario.id);
  }
  function aplicarUsuario(usuario: UsuarioDetalhe) {
    setUsuarios((atuais) => atuais.map((atual) => atual.id === usuario.id ? usuario : atual));
    setDetalhes((atuais) => ({ ...atuais, [usuario.id]: usuario }));
  }
  async function criarUsuario(event: FormEvent) {
    event.preventDefault();
    if (!token || salvamento.current) return;
    const origem = revisaoEscopo.current;
    salvamento.current = true; setSalvando("novo"); setErro(null); setMensagem(null);
    try {
      const response = await fetch("/api/usuarios", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...form, vendedoresOlist: serializarVinculos(vinculosNovos), permissions: permissoesNovo }) });
      const json = await response.json() as { usuario?: UsuarioDetalhe; error?: string };
      if (origem !== revisaoEscopo.current) return;
      if (!response.ok || !json.usuario) throw new Error(json.error ?? "Não foi possível criar o usuário.");
      setForm({ nome: "", email: "", senha: "" }); setVinculosNovos([]); setPermissoesNovo(permissoesVazias()); setMostrarSenha(false); setFormAberto(false);
      setMensagem("Usuário criado na aplicação e no Authentication.");
      if (pagina !== 1) setPagina(1); else await carregar();
    } catch (error) { if (origem === revisaoEscopo.current) setErro(error instanceof Error ? error.message : "Erro inesperado."); }
    finally { if (origem === revisaoEscopo.current) { salvamento.current = false; setSalvando(null); } }
  }
  async function atualizar(usuarioId: string, payload: { permission?: PermissionKey; value?: boolean; all?: boolean }) {
    if (!token || salvamento.current) return;
    const origem = revisaoEscopo.current;
    salvamento.current = true; setSalvando(usuarioId); setErro(null); setMensagem(null);
    try {
      const response = await fetch("/api/usuarios", { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ usuarioId, ...payload }) });
      const json = await response.json() as { usuario?: UsuarioDetalhe; error?: string };
      if (origem !== revisaoEscopo.current) return;
      if (!response.ok || !json.usuario) throw new Error(json.error ?? "Não foi possível atualizar as permissões.");
      aplicarUsuario(json.usuario);
    } catch (error) { if (origem === revisaoEscopo.current) setErro(error instanceof Error ? error.message : "Erro inesperado."); }
    finally { if (origem === revisaoEscopo.current) { salvamento.current = false; setSalvando(null); } }
  }
  async function abrirEdicao(usuario: UsuarioResumo) {
    const revisao = ++detalheRequest.current;
    const origem = revisaoEscopo.current;
    setCarregandoDetalhe(usuario.id); setErro(null); setFeedbackEdicao(null);
    try {
      const [detalhe] = await Promise.all([buscarDetalhe(usuario.id), carregarAplicativos()]);
      if (origem !== revisaoEscopo.current || revisao !== detalheRequest.current) return;
      setEditando(usuario.id); setExpandido(usuario.id);
      setEdicao({ nome: detalhe.nome, email: detalhe.email, ativo: detalhe.ativo, vinculosOlistVersao: detalhe.vinculosOlistVersao });
      setVinculosEdicao(detalhe.vendedoresOlist.map((vinculo) => ({ aplicativoId: vinculo.aplicativoId, vendedorOlistId: String(vinculo.vendedorOlistId) })));
    } catch (error) { if (origem === revisaoEscopo.current && revisao === detalheRequest.current) setErro(error instanceof Error ? error.message : "Erro inesperado."); }
    finally { if (origem === revisaoEscopo.current && revisao === detalheRequest.current) setCarregandoDetalhe(null); }
  }
  async function salvarEdicao(event: FormEvent, usuarioId: string) {
    event.preventDefault();
    if (!token || salvamento.current) return;
    const origem = revisaoEscopo.current;
    salvamento.current = true; setSalvando(usuarioId); setErro(null); setMensagem(null); setFeedbackEdicao(null);
    try {
      const response = await fetch("/api/usuarios", { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ usuarioId, profile: { ...edicao, vendedoresOlist: serializarVinculos(vinculosEdicao) } }) });
      const json = await response.json() as { usuario?: UsuarioDetalhe; error?: string };
      if (origem !== revisaoEscopo.current) return;
      if (!response.ok || !json.usuario) throw new Error(json.error ?? "Não foi possível editar o usuário.");
      aplicarUsuario(json.usuario); setEditando(null);
      setFeedbackEdicao({ usuarioId, tipo: "sucesso", mensagem: "Usuário atualizado com sucesso." });
    } catch (error) {
      if (origem === revisaoEscopo.current) setFeedbackEdicao({
        usuarioId, tipo: "erro", mensagem: error instanceof Error ? error.message : "Não foi possível salvar o usuário. Tente novamente.",
      });
    }
    finally { if (origem === revisaoEscopo.current) { salvamento.current = false; setSalvando(null); } }
  }
  async function compartilharLogin(email: string) {
    const url = `https://sistema.meuryshop.com.br/login?email=${encodeURIComponent(email)}`;
    try {
      if (navigator.share) await navigator.share({ title: "Acesso ao sistema", text: "Acesse o sistema com seu e-mail:", url });
      else { await navigator.clipboard.writeText(url); setMensagem("Link de login copiado."); }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setErro("Não foi possível compartilhar o link de login.");
    }
  }

  if (escopoCache !== escopo) return <p role="status" className="text-sm text-slate-600">Carregando usuários...</p>;

  return <div className="space-y-6">
    <PageHeader title="Usuários" description="Administre os usuários e as permissões deste aplicativo." />
    <div className="flex justify-end"><button ref={criarBotao} type="button" onClick={() => { setErro(null); setFormAberto(true); }} className={primario}>Criar usuário</button></div>
    {erro && !formAberto && <p role="alert" className="break-words rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</p>}
    {mensagem && <p role="status" className="break-words rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{mensagem}</p>}
    {formAberto && <dialog ref={dialogo} onKeyDown={conterFocoNoDialogo} aria-labelledby="criar-usuario-titulo" onCancel={(event) => { if (salvando === "novo") event.preventDefault(); else setFormAberto(false); }} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-5 text-slate-900 backdrop:bg-slate-950/60 sm:p-6">
      <form onSubmit={criarUsuario} className="grid min-w-0 gap-4 md:grid-cols-2" aria-busy={salvando === "novo"}>
        <div className="flex flex-wrap items-center justify-between gap-3 md:col-span-2"><div><h2 id="criar-usuario-titulo" className="text-lg font-semibold">Criar usuário</h2><p className="text-sm text-slate-500">Cadastre o acesso e defina as permissões.</p></div><button type="button" disabled={salvando === "novo"} onClick={() => setFormAberto(false)} className={botao}>Fechar</button></div>
        {erro && <p ref={formularioErro} tabIndex={-1} role="alert" className="break-words text-sm text-red-700 md:col-span-2">{erro}</p>}
        <label className="min-w-0 text-sm font-medium text-slate-700">Nome<input required minLength={2} maxLength={200} autoComplete="name" value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} className="input mt-1 min-h-11" /></label>
        <label className="min-w-0 text-sm font-medium text-slate-700">E-mail<input required type="email" autoComplete="email" maxLength={320} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="input mt-1 min-h-11" /></label>
        <label className="min-w-0 text-sm font-medium text-slate-700">Senha<span className="mt-1 flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-3"><input required type={mostrarSenha ? "text" : "password"} minLength={6} maxLength={256} autoComplete="new-password" value={form.senha} onChange={(event) => setForm({ ...form, senha: event.target.value })} className="min-w-0 flex-1 border-0 bg-transparent py-2 outline-none focus-visible:ring-2 focus-visible:ring-slate-500" /><button type="button" onClick={() => setMostrarSenha((visivel) => !visivel)} aria-label={mostrarSenha ? "Ocultar senha" : "Visualizar senha"} className="ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-500 focus-visible:outline focus-visible:outline-2">{mostrarSenha ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}</button></span></label>
        <div className="min-w-0 md:col-span-2"><VendedoresDoUsuario vinculos={vinculosNovos} aplicativos={aplicativos} carregando={carregandoAplicativos} disabled={salvando === "novo"} aoAlterar={setVinculosNovos} />{!aplicativos && !carregandoAplicativos && <button type="button" className={`${botao} mt-2`} onClick={() => void carregarAplicativos().catch((error: unknown) => setErro(error instanceof Error ? error.message : "Falha ao carregar aplicativos."))}>Tentar carregar aplicativos</button>}</div>
        <section className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4 md:col-span-2"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-900">Permissões do novo usuário</h3><div className="flex flex-wrap gap-2"><button type="button" disabled={salvando === "novo"} onClick={() => setPermissoesNovo(Object.fromEntries(permissionKeys.map((permission) => [permission, true])) as PermissionSet)} className={botao}>Ativar todas</button><button type="button" disabled={salvando === "novo"} onClick={() => setPermissoesNovo(permissoesVazias())} className={botao}>Desativar todas</button></div></div><PermissoesUsuario permissoes={permissoesNovo} disabled={salvando === "novo"} aoAlterar={(permission, value) => setPermissoesNovo({ ...permissoesNovo, [permission]: value })} /></section>
        <button disabled={salvando === "novo" || carregandoAplicativos} className={`${primario} md:col-span-2`}>{salvando === "novo" ? "Criando..." : "Criar usuário"}</button>
      </form>
    </dialog>}
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" aria-busy={carregando}>
      <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-900">Usuários do aplicativo</h2><p className="text-sm text-slate-500">{paginacao.total} cadastrados</p></div>
      {carregando ? <p role="status" className="p-6 text-sm text-slate-500">Carregando...</p> : usuarios.length === 0 ? <p className="p-6 text-sm text-slate-500">Nenhum usuário cadastrado.</p> : <div className="divide-y divide-slate-100">{usuarios.map((usuario) => {
        const aberto = expandido === usuario.id;
        const detalhe = detalhes[usuario.id];
        return <article key={usuario.id}>
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"><button type="button" onClick={() => void expandir(usuario)} aria-expanded={aberto} aria-controls={`usuario-${usuario.id}`} className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-4 rounded-md text-left focus-visible:outline focus-visible:outline-2"><div className="min-w-0"><p className="break-words font-medium text-slate-900">{usuario.nome}</p><p className="break-all text-sm text-slate-500">{usuario.email}</p><p className="text-xs text-slate-500">{usuario.vendedoresOlistQuantidade} vínculo(s) de vendedor Olist · {usuario.ativo ? "Ativo" : "Inativo"}</p></div><span className="shrink-0 text-sm text-slate-500">{aberto ? "Fechar ▲" : "Detalhes ▼"}</span></button><button type="button" onClick={() => void compartilharLogin(usuario.email)} className={botao}>Compartilhar login</button></div>
          {aberto && <div id={`usuario-${usuario.id}`} className="min-w-0 space-y-4 border-t border-slate-100 bg-slate-50/70 p-5">
            {carregandoDetalhe === usuario.id ? <p role="status" className="text-sm text-slate-600">Carregando detalhes...</p> : detalhe ? <>
              <div className="flex flex-wrap gap-2"><button type="button" disabled={salvando !== null} onClick={() => editando === usuario.id ? setEditando(null) : void abrirEdicao(usuario)} className={botao}>{editando === usuario.id ? "Cancelar edição" : "Editar usuário"}</button><button type="button" disabled={salvando !== null} onClick={() => void atualizar(usuario.id, { all: true })} className={botao}>Ativar todas</button><button type="button" disabled={salvando !== null} onClick={() => void atualizar(usuario.id, { all: false })} className={botao}>Desativar todas</button></div>
              {editando === usuario.id ? <form onSubmit={(event) => void salvarEdicao(event, usuario.id)} className="grid min-w-0 gap-4 rounded-md border border-slate-200 bg-white p-4 md:grid-cols-2" aria-busy={salvando === usuario.id}>
                <label className="min-w-0 text-sm text-slate-700">Nome<input required minLength={2} maxLength={200} value={edicao.nome} onChange={(event) => setEdicao({ ...edicao, nome: event.target.value })} className="input mt-1 min-h-11" /></label>
                <label className="min-w-0 text-sm text-slate-700">E-mail<input required type="email" maxLength={320} value={edicao.email} onChange={(event) => setEdicao({ ...edicao, email: event.target.value })} className="input mt-1 min-h-11" /></label>
                <label className="flex min-h-11 items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={edicao.ativo} onChange={(event) => setEdicao({ ...edicao, ativo: event.target.checked })} />Usuário ativo</label>
                <div className="min-w-0 md:col-span-2"><VendedoresDoUsuario vinculos={vinculosEdicao} aplicativos={aplicativos} carregando={carregandoAplicativos} disabled={salvando === usuario.id} aoAlterar={setVinculosEdicao} /></div>
                <div className="flex flex-wrap gap-2 md:col-span-2"><button disabled={salvando === usuario.id} className={primario}>{salvando === usuario.id ? "Salvando..." : "Salvar usuário"}</button><button type="button" disabled={salvando === usuario.id} className={botao} onClick={() => void abrirEdicao(usuario)}>Recarregar dados salvos</button></div>
              </form> : <p className="text-sm text-slate-600">{detalhe.vendedoresOlistQuantidade ? "Edite o usuário para conferir e alterar os IDs por aplicativo." : "Nenhum vendedor Olist vinculado."}</p>}
              {feedbackEdicao?.usuarioId === usuario.id && <p ref={feedbackEdicaoRef} tabIndex={-1} role={feedbackEdicao.tipo === "erro" ? "alert" : "status"} className={`break-words rounded-md border px-4 py-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${feedbackEdicao.tipo === "erro" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{feedbackEdicao.mensagem}</p>}
              <PermissoesUsuario permissoes={detalhe} disabled={salvando !== null} aoAlterar={(permission, value) => void atualizar(usuario.id, { permission, value })} />
            </> : <button type="button" className={botao} onClick={() => void recarregarDetalhe(usuario.id)}>Tentar carregar detalhes</button>}
          </div>}
        </article>;
      })}</div>}
      <nav aria-label="Paginação dos usuários" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4"><p className="text-sm text-slate-600">Página {paginacao.pagina} de {paginacao.totalPaginas}</p><div className="flex flex-wrap gap-2"><button type="button" className={botao} disabled={carregando || pagina <= 1 || salvando !== null} onClick={() => { setExpandido(null); setEditando(null); setPagina((atual) => atual - 1); }}>Anterior</button><button type="button" className={botao} disabled={carregando || pagina >= paginacao.totalPaginas || salvando !== null} onClick={() => { setExpandido(null); setEditando(null); setPagina((atual) => atual + 1); }}>Próxima</button></div></nav>
    </section>
  </div>;
}

export default function UsuariosAccessPage() {
  return <AccessGuard permissions={["podeEditarConfiguracao"]}><UsuariosPage /></AccessGuard>;
}
