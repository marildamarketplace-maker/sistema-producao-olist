"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

type Aplicativo = { id: string; nome: string };
type Resumo = { id: string; nome: string; aplicativo: Aplicativo };
type Vinculo = { aplicativoId: string; vendedorOlistId: number; confirmado: boolean };
type Detalhe = Resumo & { vinculosOlistVersao: number; vendedoresOlist: Vinculo[] };
type LinhaEdicao = { aplicativoId: string; vendedorOlistId: string; confirmar: boolean; confirmado: boolean };
type Paginacao = { pagina: number; total: number; totalPaginas: number };
type Resposta = { usuario?: Detalhe; usuarios?: Resumo[]; aplicativos?: Aplicativo[]; paginacao?: Paginacao; error?: string };
const API = "/api/usuarios/clientes";
const botao = "min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";

/** A chave do componente acompanha usuário/aplicativo, isolando os rascunhos por sessão. */
export function UsuariosClientes({ token }: { token: string | undefined }) {
  const [usuarios, setUsuarios] = useState<Resumo[]>([]);
  const [pagina, setPagina] = useState(1);
  const [paginacao, setPaginacao] = useState<Paginacao>({ pagina: 1, total: 0, totalPaginas: 1 });
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState("");
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [aplicativos, setAplicativos] = useState<Aplicativo[]>([]);
  const [linhas, setLinhas] = useState<LinhaEdicao[]>([]);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [feedback, setFeedback] = useState<{ erro: boolean; mensagem: string } | null>(null);
  const [revisaoLista, setRevisaoLista] = useState(0);
  const ativo = useRef(true);
  const pedidoDetalhe = useRef<AbortController | null>(null);
  const envioEmCurso = useRef(false);
  const mensagem = useRef<HTMLParagraphElement>(null);

  useEffect(() => { ativo.current = true; return () => { ativo.current = false; pedidoDetalhe.current?.abort(); }; }, []);
  useEffect(() => {
    if (!feedback) return;
    mensagem.current?.focus({ preventScroll: true });
    mensagem.current?.scrollIntoView({ block: "nearest" });
  }, [feedback]);
  useEffect(() => {
    const controller = new AbortController();
    if (!token) { setCarregando(false); return; }
    setCarregando(true); setErroLista("");
    void fetch(`${API}?pagina=${pagina}&limite=50`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal })
      .then(async response => {
        const dados = await response.json() as Resposta;
        if (!response.ok || !dados.usuarios || !dados.paginacao) throw new Error(dados.error ?? "Não foi possível carregar os usuários clientes.");
        if (controller.signal.aborted) return;
        if (pagina > dados.paginacao.totalPaginas) { setPagina(dados.paginacao.totalPaginas); return; }
        setUsuarios(dados.usuarios); setPaginacao(dados.paginacao);
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setErroLista(error instanceof Error ? error.message : "Falha ao carregar os usuários clientes."); })
      .finally(() => { if (!controller.signal.aborted) setCarregando(false); });
    return () => controller.abort();
  }, [token, pagina, revisaoLista]);

  function aplicarDetalhe(usuario: Detalhe, opcoes: Aplicativo[]) {
    setDetalhe(usuario); setAplicativos(opcoes);
    // Vínculos revogados são apenas uma sugestão: nunca entram marcados para confirmação.
    setLinhas(opcoes.map(app => {
      const vinculo = usuario.vendedoresOlist.find(v => v.aplicativoId === app.id);
      return { aplicativoId: app.id, vendedorOlistId: vinculo ? String(vinculo.vendedorOlistId) : "",
        confirmado: vinculo?.confirmado ?? false, confirmar: vinculo?.confirmado ?? false };
    }));
  }
  async function abrir(usuarioId: string) {
    if (!token || envioEmCurso.current) return;
    pedidoDetalhe.current?.abort();
    const controller = new AbortController(); pedidoDetalhe.current = controller;
    setAbrindo(usuarioId); setFeedback(null);
    try {
      const response = await fetch(`${API}?usuarioId=${encodeURIComponent(usuarioId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
      const dados = await response.json() as Resposta;
      if (!response.ok || !dados.usuario || !dados.aplicativos) throw new Error(dados.error ?? "Não foi possível carregar os vínculos.");
      if (!ativo.current || controller.signal.aborted) return;
      aplicarDetalhe(dados.usuario, dados.aplicativos);
    } catch (error) {
      if (ativo.current && !controller.signal.aborted) setFeedback({ erro: true, mensagem: error instanceof Error ? error.message : "Falha ao carregar os vínculos." });
    } finally { if (ativo.current && !controller.signal.aborted) setAbrindo(null); }
  }
  async function salvar(event: FormEvent) {
    event.preventDefault();
    if (!token || !detalhe || envioEmCurso.current) return;
    const selecionadas = linhas.filter(linha => linha.confirmar);
    if (selecionadas.some(linha => !/^\d+$/.test(linha.vendedorOlistId) || Number(linha.vendedorOlistId) < 1 || Number(linha.vendedorOlistId) > 2147483647)) {
      setFeedback({ erro: true, mensagem: "Informe um ID de vendedor válido para cada empresa marcada." }); return;
    }
    envioEmCurso.current = true; setSalvando(true); setFeedback(null);
    try {
      const response = await fetch(API, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({
        usuarioId: detalhe.id, vinculosOlistVersao: detalhe.vinculosOlistVersao,
        vendedoresOlist: selecionadas.map(linha => ({ aplicativoId: linha.aplicativoId, vendedorOlistId: Number(linha.vendedorOlistId) })),
      }) });
      const dados = await response.json() as Resposta;
      if (!ativo.current) return;
      if (!response.ok || !dados.usuario || !dados.aplicativos) throw new Error(dados.error ?? "Não foi possível confirmar os vínculos.");
      aplicarDetalhe(dados.usuario, dados.aplicativos);
      setFeedback({ erro: false, mensagem: "Vínculos de vendedor atualizados nas empresas selecionadas." });
    } catch (error) {
      if (ativo.current) setFeedback({ erro: true, mensagem: error instanceof Error ? error.message : "Não foi possível confirmar os vínculos." });
    } finally { if (ativo.current) { envioEmCurso.current = false; setSalvando(false); } }
  }
  function mudarPagina(nova: number) {
    pedidoDetalhe.current?.abort(); setDetalhe(null); setAbrindo(null); setFeedback(null); setPagina(nova);
  }

  return <section className="min-w-0 rounded-lg border border-slate-200 bg-white" aria-labelledby="usuarios-clientes-titulo">
    <div className="border-b border-slate-200 p-5">
      <h2 id="usuarios-clientes-titulo" className="text-lg font-semibold text-slate-900">Usuários de aplicativos clientes</h2>
      <p className="mt-1 text-sm text-slate-600">Configure os vendedores das suas empresas para quem cadastrou este aplicativo como fornecedor. Conta e permissões são administradas no aplicativo de origem.</p>
    </div>
    {carregando ? <p role="status" className="p-5 text-sm text-slate-600">Carregando usuários clientes...</p>
      : erroLista ? <div className="space-y-3 p-5"><p role="alert" className="break-words text-sm text-red-700">{erroLista}</p><button type="button" className={botao} onClick={() => setRevisaoLista(n => n + 1)}>Recarregar usuários clientes</button></div>
      : !usuarios.length ? <p className="p-5 text-sm text-slate-600">Nenhum aplicativo cliente com relação de fornecimento ativa.</p>
      : <div className="divide-y divide-slate-200">{usuarios.map(usuario => <article key={usuario.id} className="min-w-0 space-y-4 p-5">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><h3 className="break-words font-medium text-slate-900">{usuario.nome}</h3><p className="break-words text-sm text-slate-600">Aplicativo de origem: {usuario.aplicativo.nome}</p></div>
          <button type="button" className={botao} disabled={salvando || abrindo !== null} aria-expanded={detalhe?.id === usuario.id}
            onClick={() => detalhe?.id === usuario.id ? (setDetalhe(null), setFeedback(null)) : void abrir(usuario.id)}>{abrindo === usuario.id ? "Carregando vínculos..." : detalhe?.id === usuario.id ? "Fechar configuração" : "Configurar vendedores"}</button>
        </div>
        {detalhe?.id === usuario.id && <form onSubmit={event => void salvar(event)} className="min-w-0 space-y-4" aria-label={`Vendedores de ${usuario.nome}`} aria-busy={salvando}>
          <p className="text-sm text-slate-600">Marque as empresas cujos vínculos devem ficar confirmados. Desmarcar uma empresa revoga somente esse vínculo. IDs anteriores aguardam nova confirmação após encerrar o fornecimento.</p>
          <fieldset disabled={salvando} className="space-y-3"><legend className="sr-only">Empresas e vendedores</legend>
            {linhas.map((linha, indice) => <div key={linha.aplicativoId} className="grid min-w-0 gap-3 rounded-md border border-slate-200 p-4 sm:grid-cols-2">
              <label className="flex min-h-11 min-w-0 items-center gap-3 text-sm font-medium text-slate-900">
                <input type="checkbox" checked={linha.confirmar} onChange={event => setLinhas(atuais => atuais.map((atual, posicao) => posicao === indice ? { ...atual, confirmar: event.target.checked } : atual))} />
                <span className="break-words">Confirmar em {aplicativos.find(app => app.id === linha.aplicativoId)?.nome}</span>
              </label>
              <label className="min-w-0 text-sm text-slate-700">ID vendedor Olist
                <input required={linha.confirmar} disabled={!linha.confirmar} value={linha.vendedorOlistId} inputMode="numeric" pattern="[0-9]+" maxLength={10} className="input mt-1 min-h-11 w-full"
                  onChange={event => setLinhas(atuais => atuais.map((atual, posicao) => posicao === indice ? { ...atual, vendedorOlistId: event.target.value.replace(/\D/g, "") } : atual))} />
              </label>
              <p className="text-sm text-slate-600 sm:col-span-2">{linha.confirmado ? "Vínculo confirmado" : linha.vendedorOlistId ? "Aguardando nova confirmação" : "Sem vínculo"}</p>
            </div>)}
          </fieldset>
          <div className="flex flex-wrap gap-3"><button disabled={salvando} className={`${botao} bg-slate-900 text-white hover:bg-slate-800`}>{salvando ? "Salvando vínculos..." : "Salvar vínculos de vendedor"}</button><button type="button" disabled={salvando || abrindo !== null} className={botao} onClick={() => void abrir(usuario.id)}>Recarregar vínculos salvos</button></div>
        </form>}
      </article>)}</div>}
    {feedback && <p ref={mensagem} tabIndex={-1} role={feedback.erro ? "alert" : "status"} className={`m-5 break-words rounded-md border p-4 text-sm ${feedback.erro ? "border-red-200 text-red-700" : "border-emerald-200 text-emerald-700"}`}>{feedback.mensagem}</p>}
    {!erroLista && <nav aria-label="Paginação dos usuários clientes" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-5"><p className="text-sm text-slate-600">{paginacao.total} usuários · Página {paginacao.pagina} de {paginacao.totalPaginas}</p><div className="flex flex-wrap gap-3"><button type="button" className={botao} disabled={carregando || salvando || pagina <= 1} onClick={() => mudarPagina(pagina - 1)}>Clientes anteriores</button><button type="button" className={botao} disabled={carregando || salvando || pagina >= paginacao.totalPaginas} onClick={() => mudarPagina(pagina + 1)}>Próximos clientes</button></div></nav>}
  </section>;
}
