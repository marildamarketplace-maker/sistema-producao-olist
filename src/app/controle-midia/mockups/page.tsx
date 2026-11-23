"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useModalFocus } from "@/hooks/use-modal-focus";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { MOCKUP_FORMATOS, MOCKUP_MAX_BYTES, MOCKUP_NOME_MAX, MOCKUP_CATEGORIA_MAX, MOCKUP_OBSERVACAO_MAX, type Mockup, type TipoMockup } from "@/lib/mockups";
import { ImagemPrivadaMockup, VisualizacaoMockup } from "@/components/mockups/visualizacao-mockup";
import { mensagemMockups, requisitarMockups } from "@/lib/mockups-client";

const botao = "inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60";
const estadoVazio = { nome: "", tipo: "INDIVIDUAL" as TipoMockup, categoria: "", observacaoPrompt: "" };

export default function MockupsPage() {
  const { session } = useAuth();
  return (
    <AccessGuard permissions={["podeVisualizarCategoriasMidia", "podeCriarMockups"]}>
      <div className="space-y-8">
        <PageHeader title="Mockups" description="Cadastre e gerencie mockups e informativos na nuvem." />
        {session?.access_token && <CadastroMockups key={session.user.id} token={session.access_token} />}
      </div>
    </AccessGuard>
  );
}

function CadastroMockups({ token }: { token: string }) {
  const [mockups, setMockups] = useState<Mockup[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState("");
  const [revisao, setRevisao] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [carregandoEdicaoId, setCarregandoEdicaoId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState({ erro: "", sucesso: "" });
  const [selecionado, setSelecionado] = useState<Mockup | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [dados, setDados] = useState(estadoVazio);
  const [imagem, setImagem] = useState<File | null>(null);

  const [camposFiltro, setCamposFiltro] = useState({ nome: "", tipo: "", categoria: "" });
  const [consulta, setConsulta] = useState("?incluirInformativos=1");

  useEffect(() => {
    const controller = new AbortController();
    setCarregando(true);
    setErroLista("");
    setMockups([]);
    setCursor(null);
    requisitarMockups(token, consulta, { signal: controller.signal })
      .then((response) => response.json())
      .then((data: { mockups: Mockup[]; cursor: string | null }) => {
        if (controller.signal.aborted) return;
        setMockups(data.mockups);
        setCursor(data.cursor);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setErroLista(mensagemMockups(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setCarregando(false);
      });
    return () => controller.abort();
  }, [token, revisao, consulta]);

  async function iniciarEdicao(mockup: Mockup) {
    setCarregandoEdicaoId(mockup.id);
    setFeedback({ erro: "", sucesso: "" });
    try {
      const response = await requisitarMockups(token, `?detalhesId=${encodeURIComponent(mockup.id)}`);
      const { mockup: detalhes } = await response.json() as { mockup: Mockup };
      setSelecionado(null);
      setEditando(mockup.id);
      setDados({
        nome: detalhes.nome,
        tipo: detalhes.tipo,
        categoria: detalhes.categoria ?? "",
        observacaoPrompt: detalhes.observacaoPrompt ?? "",
      });
      setImagem(null);
      document.getElementById("mockup-nome")?.focus();
    } catch (error) {
      setFeedback({ erro: mensagemMockups(error), sucesso: "" });
    } finally {
      setCarregandoEdicaoId(null);
    }
  }

  function novoCadastro() {
    setSelecionado(null);
    setEditando(null);
    setDados(estadoVazio);
    setImagem(null);
    setFeedback({ erro: "", sucesso: "" });
  }

  async function carregarMais() {
    if (!cursor || carregando) return;
    setCarregando(true);
    setErroLista("");
    try {
      const response = await requisitarMockups(token, `${consulta}&cursor=${encodeURIComponent(cursor)}`);
      const data = await response.json() as { mockups: Mockup[]; cursor: string | null };
      setMockups((atuais) => [...atuais, ...data.mockups.filter((item) => !atuais.some(({ id }) => id === item.id))]);
      setCursor(data.cursor);
    } catch (error) {
      setErroLista(mensagemMockups(error));
    } finally {
      setCarregando(false);
    }
  }

  async function salvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (salvando) return;
    setFeedback({ erro: "", sucesso: "" });
    if (!dados.nome.trim()) {
      setFeedback({ erro: "Informe o nome do arquivo.", sucesso: "" });
      return;
    }
    if (!editando && !imagem) {
      setFeedback({ erro: "Selecione uma imagem para cadastrar.", sucesso: "" });
      return;
    }
    if (imagem && (!imagem.size || imagem.size > MOCKUP_MAX_BYTES)) {
      setFeedback({ erro: "Selecione uma imagem de até 4 MB.", sucesso: "" });
      return;
    }

    const headers = {
      "x-mockup-nome": encodeURIComponent(dados.nome.trim()),
      "x-mockup-tipo": dados.tipo,
      "x-mockup-categoria": encodeURIComponent(dados.categoria.trim()),
      "x-mockup-observacao-prompt": encodeURIComponent(dados.observacaoPrompt.trim()),
    };
    setSalvando(true);
    try {
      let response: Response;
      if (editando && imagem) {
        response = await requisitarMockups(token, `?id=${encodeURIComponent(editando)}`, {
          method: "PATCH", headers: { ...headers, "Content-Type": "application/octet-stream" }, body: imagem,
        });
      } else if (editando) {
        response = await requisitarMockups(token, `?id=${encodeURIComponent(editando)}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados),
        });
      } else {
        response = await requisitarMockups(token, "", {
          method: "POST", headers: { ...headers, "Content-Type": "application/octet-stream" }, body: imagem,
        });
      }
      const { mockup } = await response.json() as { mockup: Mockup };
      setMockups((atuais) => editando
        ? atuais.map((item) => item.id === mockup.id ? mockup : item)
        : [mockup, ...atuais.filter(({ id }) => id !== mockup.id)]);
      setSelecionado(null);
      setEditando(null);
      setDados(estadoVazio);
      setImagem(null);
      setFeedback({ erro: "", sucesso: editando ? "Alterações salvas." : "Mockup cadastrado na nuvem." });
    } catch (error) {
      setFeedback({ erro: mensagemMockups(error), sucesso: "" });
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(mockup: Mockup) {
    if (!window.confirm(`Excluir “${mockup.nome}” do catálogo e do bucket?`)) return;
    setFeedback({ erro: "", sucesso: "" });
    try {
      await requisitarMockups(token, `?id=${encodeURIComponent(mockup.id)}`, { method: "DELETE" });
      setMockups((atuais) => atuais.filter(({ id }) => id !== mockup.id));
      if (selecionado?.id === mockup.id) setSelecionado(null);
      if (editando === mockup.id) novoCadastro();
      setFeedback({ erro: "", sucesso: "Arquivo excluído do catálogo e do bucket." });
    } catch (error) {
      setFeedback({ erro: mensagemMockups(error), sucesso: "" });
    }
  }

  return (
    <div className="grid min-w-0 items-start gap-6">
      <section id="cadastro-mockup" className="scroll-mt-4 min-w-0 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-900">{editando ? "Editar arquivo" : "Cadastrar arquivo"}</h2>
          {editando && <button type="button" className={`${botao} border border-slate-300 text-slate-800`} onClick={novoCadastro}>Novo cadastro</button>}
        </div>
        <form onSubmit={salvar} className="mt-4">
          <fieldset disabled={salvando} className="min-w-0 space-y-4">
            <div>
              <label htmlFor="mockup-nome" className="block text-sm font-medium">Nome do arquivo</label>
              <input id="mockup-nome" value={dados.nome} onChange={(event) => setDados((atual) => ({ ...atual, nome: event.target.value }))}
                required maxLength={MOCKUP_NOME_MAX} className="input mt-1 min-h-11 w-full" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="mockup-tipo" className="block text-sm font-medium">Tipo</label>
                <select id="mockup-tipo" value={dados.tipo} disabled={Boolean(editando)}
                  onChange={(event) => setDados((atual) => ({ ...atual, tipo: event.target.value as TipoMockup }))} className="input mt-1 min-h-11 w-full">
                  <option value="INDIVIDUAL">Individual</option>
                  <option value="LAYOUT">Layout</option>
                  <option value="INFORMATIVO">Informativo</option>
                </select>
                {editando && <p className="mt-1 text-xs text-slate-500">O tipo é fixado no cadastro para preservar a compatibilidade com lotes já criados.</p>}
              </div>
              <div>
                <label htmlFor="mockup-categoria" className="block text-sm font-medium">Categoria / produto</label>
                <input id="mockup-categoria" value={dados.categoria} onChange={(event) => setDados((atual) => ({ ...atual, categoria: event.target.value }))}
                  maxLength={MOCKUP_CATEGORIA_MAX} className="input mt-1 min-h-11 w-full" placeholder="Ex.: Lenço, Painel, Forro redondo" />
              </div>
            </div>
            <div>
              <label htmlFor="mockup-observacao" className="block text-sm font-medium">Observação para o prompt</label>
              <textarea id="mockup-observacao" value={dados.observacaoPrompt} onChange={(event) => setDados((atual) => ({ ...atual, observacaoPrompt: event.target.value }))}
                maxLength={MOCKUP_OBSERVACAO_MAX} rows={4} className="input mt-1 w-full" placeholder="Explique onde e como a estampa deve ser aplicada, incluindo dobras, quadros ou repetição." />
              <p className="mt-1 text-xs text-slate-600">Instruções específicas anexadas ao prompt de geração deste mockup.</p>
            </div>
            <div>
              <label htmlFor="mockup-imagem" className="block text-sm font-medium">Imagem {editando ? "(opcional para substituir)" : ""}</label>
              <input id="mockup-imagem" type="file" accept={MOCKUP_FORMATOS} required={!editando} onChange={(event) => setImagem(event.target.files?.[0] ?? null)}
                aria-describedby="mockup-formatos" className="input mt-1 min-h-11 w-full min-w-0" />
              <p id="mockup-formatos" className="mt-1 text-xs text-slate-600">JPG, PNG ou WebP estático, até 4 MB e 16 megapixels. A imagem é otimizada em WebP, mantendo a proporção, com até 2048 px e 1 MB no bucket.</p>
            </div>
            <button className={`${botao} w-full bg-slate-900 text-white sm:w-auto`} type="submit">
              {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Cadastrar no bucket"}
            </button>
          </fieldset>
          {feedback.erro && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{feedback.erro}</p>}
          <p role="status" className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">{feedback.sucesso}</p>
        </form>
      </section>
      <section className="min-w-0 space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Arquivos cadastrados</h2>
        <p className="text-sm text-slate-600">Compare as imagens abaixo ou use Editar para alterar o cadastro.</p>
        <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => {
          event.preventDefault();
          if (carregando) return;
          setSelecionado(null);
          setConsulta(`?${new URLSearchParams({ incluirInformativos: "1", ...camposFiltro })}`);
        }}>
          <div>
            <label htmlFor="filtro-mockup-nome" className="block text-sm font-medium">Nome</label>
            <input id="filtro-mockup-nome" className="input mt-1 min-h-11 w-full" maxLength={MOCKUP_NOME_MAX}
              value={camposFiltro.nome} onChange={(event) => setCamposFiltro((atual) => ({ ...atual, nome: event.target.value }))} />
          </div>
          <div>
            <label htmlFor="filtro-mockup-tipo" className="block text-sm font-medium">Tipo</label>
            <select id="filtro-mockup-tipo" className="input mt-1 min-h-11 w-full" value={camposFiltro.tipo}
              onChange={(event) => setCamposFiltro((atual) => ({ ...atual, tipo: event.target.value }))}>
              <option value="">Todos</option>
              <option value="INDIVIDUAL">Individual</option>
              <option value="LAYOUT">Layout</option>
              <option value="INFORMATIVO">Informativo</option>
            </select>
          </div>
          <div>
            <label htmlFor="filtro-mockup-categoria" className="block text-sm font-medium">Categoria / produto</label>
            <input id="filtro-mockup-categoria" className="input mt-1 min-h-11 w-full" maxLength={MOCKUP_CATEGORIA_MAX}
              value={camposFiltro.categoria} onChange={(event) => setCamposFiltro((atual) => ({ ...atual, categoria: event.target.value }))} />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <button type="submit" disabled={carregando} className={`${botao} bg-slate-900 text-white`}>Filtrar</button>
            <button type="button" disabled={carregando} className={`${botao} border border-slate-300`} onClick={() => {
              setCamposFiltro({ nome: "", tipo: "", categoria: "" });
              setSelecionado(null);
              setConsulta("?incluirInformativos=1");
            }}>Limpar</button>
          </div>
        </form>
        {erroLista && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{erroLista}</p>}
        {erroLista && !cursor && <button type="button" className={`${botao} border border-slate-300`} onClick={() => setRevisao((valor) => valor + 1)}>Tentar novamente</button>}
        {carregando && <p role="status" className="text-sm text-slate-600">Carregando arquivos…</p>}
        {!carregando && !erroLista && !mockups.length && <p className="text-sm text-slate-600">Nenhum arquivo encontrado.</p>}
        {mockups.length > 0 && (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {mockups.map((mockup) => (
              <li key={mockup.id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-slate-200 p-3">
                <ImagemPrivadaMockup nome={mockup.nome} token={token} rota={`?id=${encodeURIComponent(mockup.id)}`} miniatura onAmpliar={() => setSelecionado(mockup)} />
                <div className="min-w-0 break-words text-left text-sm">
                  <span className="block font-medium">{mockup.nome}</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {mockup.tipo === "LAYOUT" ? "Layout" : mockup.tipo === "INFORMATIVO" ? "Informativo" : "Individual"}
                    {mockup.categoria ? ` · ${mockup.categoria}` : ""}
                  </span>
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  <button type="button" disabled={carregandoEdicaoId === mockup.id} className={`${botao} border border-slate-300 text-slate-800`}
                    onClick={() => void iniciarEdicao(mockup)}>{carregandoEdicaoId === mockup.id ? "Carregando…" : "Editar"}</button>
                  <button type="button" className={`${botao} border border-rose-300 text-rose-700 hover:bg-rose-50`} onClick={() => void excluir(mockup)}>Excluir</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {cursor && <button type="button" disabled={carregando} onClick={() => void carregarMais()} className={`${botao} border border-slate-300`}>Carregar mais</button>}
        {selecionado && <PreviaCatalogo key={selecionado.id} mockup={selecionado} token={token} fechar={() => setSelecionado(null)} />}
      </section>
    </div>
  );
}

function PreviaCatalogo({ mockup, token, fechar }: { mockup: Mockup; token: string; fechar: () => void }) {
  const modal = useModalFocus(fechar);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div ref={modal} role="dialog" aria-modal="true" aria-label={`Prévia de ${mockup.nome}`} tabIndex={-1}
        className="max-h-[85dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <button type="button" className={`${botao} border border-slate-300`} onClick={fechar}>Fechar prévia</button>
        <VisualizacaoMockup mockup={mockup} token={token} />
      </div>
    </div>
  );
}
