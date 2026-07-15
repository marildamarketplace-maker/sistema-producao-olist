"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { permissionKeys, permissionLabels, type PermissionKey, type PermissionSet } from "@/lib/permissions";

type UsuarioAdministrado = { id: string; nome: string; email: string; ativo: boolean; vendedorOlistId: number | null } & PermissionSet;

function UsuariosPage() {
  const { session } = useAuth();
  const searchParams = useSearchParams();
  const [usuarios, setUsuarios] = useState<UsuarioAdministrado[]>([]);
  const [formAberto, setFormAberto] = useState(false);
  const [form, setForm] = useState({ nome: "", email: "", senha: "", vendedorOlistId: "" });
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [permissoesNovo, setPermissoesNovo] = useState<PermissionSet>(() => Object.fromEntries(permissionKeys.map((permission) => [permission, false])) as PermissionSet);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [edicao, setEdicao] = useState({ nome: "", email: "", vendedorOlistId: "", ativo: true });
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!session?.access_token) return;
    setCarregando(true); setErro(null);
    try {
      const response = await fetch("/api/usuarios", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const json = await response.json() as { usuarios?: UsuarioAdministrado[]; error?: string };
      if (!response.ok) throw new Error(json.error ?? "Não foi possível carregar os usuários.");
      setUsuarios(json.usuarios ?? []);
    } catch (error) { setErro(error instanceof Error ? error.message : "Erro inesperado."); }
    finally { setCarregando(false); }
  }, [session?.access_token]);

  useEffect(() => { void carregar(); }, [carregar]);

  useEffect(() => {
    if (searchParams.get("novo") !== "1") return;
    setFormAberto(true);
    setForm({
      nome: searchParams.get("nome")?.trim() ?? "",
      email: searchParams.get("email")?.trim() ?? "",
      senha: "",
      vendedorOlistId: searchParams.get("vendedorOlistId")?.replace(/\D/g, "") ?? "",
    });
  }, [searchParams]);

  async function criarUsuario(event: FormEvent) {
    event.preventDefault();
    if (!session?.access_token) return;
    setSalvando("novo"); setErro(null); setMensagem(null);
    try {
      const response = await fetch("/api/usuarios", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...form, permissions: permissoesNovo }) });
      const json = await response.json() as { usuario?: UsuarioAdministrado; error?: string };
      if (!response.ok || !json.usuario) throw new Error(json.error ?? "Não foi possível criar o usuário.");
      setUsuarios((atuais) => [...atuais, json.usuario!].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
      setForm({ nome: "", email: "", senha: "", vendedorOlistId: "" }); setPermissoesNovo(Object.fromEntries(permissionKeys.map((permission) => [permission, false])) as PermissionSet); setMostrarSenha(false); setFormAberto(false); setMensagem("Usuário criado na aplicação e no Authentication.");
    } catch (error) { setErro(error instanceof Error ? error.message : "Erro inesperado."); }
    finally { setSalvando(null); }
  }

  async function atualizar(usuarioId: string, payload: { permission?: PermissionKey; value?: boolean; all?: boolean }) {
    if (!session?.access_token) return;
    setSalvando(usuarioId); setErro(null); setMensagem(null);
    try {
      const response = await fetch("/api/usuarios", { method: "PATCH", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ usuarioId, ...payload }) });
      const json = await response.json() as { usuario?: UsuarioAdministrado; error?: string };
      if (!response.ok || !json.usuario) throw new Error(json.error ?? "Não foi possível atualizar as permissões.");
      setUsuarios((atuais) => atuais.map((usuario) => usuario.id === usuarioId ? json.usuario! : usuario));
    } catch (error) { setErro(error instanceof Error ? error.message : "Erro inesperado."); }
    finally { setSalvando(null); }
  }

  function abrirEdicao(usuario: UsuarioAdministrado) {
    setEditando(usuario.id);
    setExpandido(usuario.id);
    setEdicao({ nome: usuario.nome, email: usuario.email, vendedorOlistId: usuario.vendedorOlistId ? String(usuario.vendedorOlistId) : "", ativo: usuario.ativo });
  }

  async function salvarEdicao(event: FormEvent, usuarioId: string) {
    event.preventDefault();
    if (!session?.access_token) return;
    setSalvando(usuarioId); setErro(null); setMensagem(null);
    try {
      const response = await fetch("/api/usuarios", { method: "PATCH", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ usuarioId, profile: edicao }) });
      const json = await response.json() as { usuario?: UsuarioAdministrado; error?: string };
      if (!response.ok || !json.usuario) throw new Error(json.error ?? "Não foi possível editar o usuário.");
      setUsuarios((atuais) => atuais.map((usuario) => usuario.id === usuarioId ? json.usuario! : usuario));
      setEditando(null); setMensagem("Usuário atualizado com sucesso.");
    } catch (error) { setErro(error instanceof Error ? error.message : "Erro inesperado."); }
    finally { setSalvando(null); }
  }

  async function compartilharLogin(email: string) {
    const url = `https://sistema.meuryshop.com.br/login?email=${encodeURIComponent(email)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Acesso ao sistema", text: "Acesse o sistema com seu e-mail:", url });
      } else {
        await navigator.clipboard.writeText(url);
        setMensagem("Link de login copiado.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setErro("Não foi possível compartilhar o link de login.");
    }
  }

  return <div className="space-y-6"><PageHeader title="Usuários" description="Administre os usuários e as permissões deste aplicativo." /><div className="flex justify-end"><button type="button" onClick={() => setFormAberto((aberto) => !aberto)} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">{formAberto ? "Cancelar" : "Criar usuário"}</button></div>{formAberto && <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><button type="button" aria-label="Fechar modal" onClick={() => setFormAberto(false)} className="absolute inset-0 h-full w-full bg-slate-950/60" /><form onSubmit={criarUsuario} className="relative z-10 grid max-h-[90vh] w-full max-w-5xl gap-4 overflow-y-auto rounded-lg border border-slate-200 bg-white p-5 shadow-2xl md:grid-cols-2 md:items-end"><div className="flex items-center justify-between md:col-span-2"><div><h2 className="text-lg font-semibold text-slate-900">Criar usuário</h2><p className="text-sm text-slate-500">Cadastre o acesso e defina as permissões.</p></div><button type="button" onClick={() => setFormAberto(false)} className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700">Fechar</button></div><label className="text-sm font-medium text-slate-700">Nome<input required value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label><label className="text-sm font-medium text-slate-700">E-mail<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label><label className="text-sm font-medium text-slate-700">Senha<span className="mt-1 flex items-center rounded-md border border-slate-300 bg-white px-3"><input required type={mostrarSenha ? "text" : "password"} minLength={6} autoComplete="new-password" value={form.senha} onChange={(event) => setForm({ ...form, senha: event.target.value })} className="min-w-0 flex-1 border-0 bg-transparent py-2 outline-none" /><button type="button" onClick={() => setMostrarSenha((visivel) => !visivel)} aria-label={mostrarSenha ? "Ocultar senha" : "Visualizar senha"} title={mostrarSenha ? "Ocultar senha" : "Visualizar senha"} className="ml-2 shrink-0 text-slate-400 hover:text-slate-700">{mostrarSenha ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}</button></span></label><label className="text-sm font-medium text-slate-700">ID vendedor Olist<input inputMode="numeric" value={form.vendedorOlistId} onChange={(event) => setForm({ ...form, vendedorOlistId: event.target.value.replace(/\D/g, "") })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label><div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4 md:col-span-2"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-900">Permissões do novo usuário</h3><div className="flex gap-2"><button type="button" onClick={() => setPermissoesNovo(Object.fromEntries(permissionKeys.map((permission) => [permission, true])) as PermissionSet)} className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white">Ativar todas</button><button type="button" onClick={() => setPermissoesNovo(Object.fromEntries(permissionKeys.map((permission) => [permission, false])) as PermissionSet)} className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white">Desativar todas</button></div></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{permissionKeys.map((permission) => <label key={permission} className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"><input type="checkbox" checked={permissoesNovo[permission]} onChange={(event) => setPermissoesNovo({ ...permissoesNovo, [permission]: event.target.checked })} />{permissionLabels[permission]}</label>)}</div></div><button disabled={salvando === "novo"} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{salvando === "novo" ? "Criando..." : "Criar usuário"}</button></form></div>}{erro && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>}{mensagem && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{mensagem}</div>}<section className="overflow-hidden rounded-lg border border-slate-200 bg-white"><div className="border-b border-slate-200 px-5 py-4"><h3 className="font-semibold text-slate-900">Usuários do aplicativo</h3><p className="text-sm text-slate-500">{usuarios.length} cadastrados</p></div>{carregando ? <p className="p-6 text-sm text-slate-500">Carregando...</p> : usuarios.length === 0 ? <p className="p-6 text-sm text-slate-500">Nenhum usuário cadastrado.</p> : <div className="divide-y divide-slate-100">{usuarios.map((usuario) => { const aberto = expandido === usuario.id; return <div key={usuario.id}><div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center"><button type="button" onClick={() => setExpandido(aberto ? null : usuario.id)} className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left"><div className="min-w-0"><p className="truncate font-medium text-slate-900">{usuario.nome}</p><p className="truncate text-sm text-slate-500">{usuario.email}</p><p className="truncate text-xs text-slate-500">Vendedor Olist: {usuario.vendedorOlistId ?? "Não definido"}</p></div><span className="shrink-0 text-sm text-slate-500">{aberto ? "Fechar ▲" : "Permissões ▼"}</span></button><button type="button" onClick={() => void compartilharLogin(usuario.email)} className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">Compartilhar login</button></div>{aberto && <div className="border-t border-slate-100 bg-slate-50/70 p-5"><div className="mb-4 flex flex-wrap gap-2"><button type="button" onClick={() => editando === usuario.id ? setEditando(null) : abrirEdicao(usuario)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700">{editando === usuario.id ? "Cancelar edição" : "Editar usuário"}</button><button type="button" disabled={salvando === usuario.id} onClick={() => void atualizar(usuario.id, { all: true })} className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Ativar todas</button><button type="button" disabled={salvando === usuario.id} onClick={() => void atualizar(usuario.id, { all: false })} className="rounded-md bg-red-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Desativar todas</button></div>{editando === usuario.id && <form onSubmit={(event) => void salvarEdicao(event, usuario.id)} className="mb-5 grid gap-3 rounded-md border border-slate-200 bg-white p-4 md:grid-cols-2"><label className="text-sm text-slate-700">Nome<input required value={edicao.nome} onChange={(event) => setEdicao({ ...edicao, nome: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label><label className="text-sm text-slate-700">E-mail<input required type="email" value={edicao.email} onChange={(event) => setEdicao({ ...edicao, email: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label><label className="text-sm text-slate-700">ID vendedor Olist<input inputMode="numeric" value={edicao.vendedorOlistId} onChange={(event) => setEdicao({ ...edicao, vendedorOlistId: event.target.value.replace(/\D/g, "") })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label><label className="flex items-center gap-3 self-end rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"><input type="checkbox" checked={edicao.ativo} onChange={(event) => setEdicao({ ...edicao, ativo: event.target.checked })} />Usuário ativo</label><button disabled={salvando === usuario.id} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 md:col-span-2">{salvando === usuario.id ? "Salvando..." : "Salvar usuário"}</button></form>}<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{permissionKeys.map((permission) => <label key={permission} className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"><input type="checkbox" disabled={salvando === usuario.id} checked={Boolean(usuario[permission])} onChange={(event) => void atualizar(usuario.id, { permission, value: event.target.checked })} />{permissionLabels[permission]}</label>)}</div></div>}</div>; })}</div>}</section></div>;
}

export default function UsuariosAccessPage() {
  return <AccessGuard permissions={["podeEditarConfiguracao"]}><UsuariosPage /></AccessGuard>;
}
