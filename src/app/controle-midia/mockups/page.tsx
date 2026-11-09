"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { MOCKUP_FORMATOS, MOCKUP_MAX_BYTES, MOCKUP_NOME_MAX, type Mockup } from "@/lib/mockups";
import { VisualizacaoMockup } from "@/components/mockups/visualizacao-mockup";
import { mensagemMockups, requisitarMockups } from "@/lib/mockups-client";

const botao = "min-h-11 rounded-md px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60";

export default function MockupsPage() {
  const { session } = useAuth();
  return (
    <AccessGuard permissions={["podeVisualizarCategoriasMidia"]}>
      <div className="space-y-8">
        <PageHeader title="Mockups" description="Cadastre e consulte suas imagens de mockup na nuvem." />
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
  const [feedback, setFeedback] = useState({ erro: "", sucesso: "" });
  const [selecionado, setSelecionado] = useState<Mockup | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setCarregando(true);
    setErroLista("");
    requisitarMockups(token, "", { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => {
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
  }, [token, revisao]);

  async function carregarMais() {
    if (!cursor || carregando) return;
    setCarregando(true);
    setErroLista("");
    try {
      const response = await requisitarMockups(token, `?cursor=${encodeURIComponent(cursor)}`);
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
    const form = event.currentTarget;
    const dados = new FormData(form);
    const nome = String(dados.get("nome") ?? "").trim();
    const imagem = dados.get("imagem");
    setFeedback({ erro: "", sucesso: "" });
    if (!nome || !(imagem instanceof File) || !imagem.size || imagem.size > MOCKUP_MAX_BYTES) {
      setFeedback({ erro: "Informe o nome e selecione uma imagem de até 4 MB.", sucesso: "" });
      return;
    }

    setSalvando(true);
    try {
      const response = await requisitarMockups(token, "", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "x-mockup-nome": encodeURIComponent(nome), "x-mockup-tipo": String(dados.get("tipo")) },
        body: imagem,
      });
      const { mockup } = await response.json() as { mockup: Mockup };
      setMockups((atuais) => [mockup, ...atuais.filter(({ id }) => id !== mockup.id)]);
      setSelecionado(mockup);
      setFeedback({ erro: "", sucesso: "Mockup salvo na nuvem." });
      form.reset();
    } catch (error) {
      setFeedback({ erro: mensagemMockups(error), sucesso: "" });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-2">
      <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Cadastrar mockup</h2>
        <form onSubmit={salvar} className="mt-4">
          <fieldset disabled={salvando} className="min-w-0 space-y-4">
            <div>
              <label htmlFor="mockup-nome" className="block text-sm font-medium">Nome do mockup</label>
              <input id="mockup-nome" name="nome" required maxLength={MOCKUP_NOME_MAX} className="input mt-1 min-h-11 w-full" />
            </div>
            <div>
              <label htmlFor="mockup-tipo" className="block text-sm font-medium">Tipo</label>
              <select id="mockup-tipo" name="tipo" className="input mt-1 min-h-11">
                <option value="INDIVIDUAL">Individual</option>
                <option value="LAYOUT">Layout</option>
              </select>
            </div>
            <div>
              <label htmlFor="mockup-imagem" className="block text-sm font-medium">Imagem</label>
              <input id="mockup-imagem" name="imagem" type="file" required accept={MOCKUP_FORMATOS}
                aria-describedby="mockup-formatos" className="input mt-1 min-h-11 w-full min-w-0" />
              <p id="mockup-formatos" className="mt-1 text-xs text-slate-600">Imagem quadrada (1:1). JPG, PNG ou WebP estático, até 4 MB e 16 megapixels.</p>
            </div>
            <button className={`${botao} w-full bg-slate-900 text-white sm:w-auto`} type="submit">
              {salvando ? "Salvando na nuvem…" : "Salvar mockup"}
            </button>
          </fieldset>
          {feedback.erro && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{feedback.erro}</p>}
          <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{feedback.sucesso}</p>
        </form>
      </section>

      <section className="min-w-0 space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Mockups cadastrados</h2>
        {erroLista && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{erroLista}</p>}
        {erroLista && !cursor && (
          <button type="button" className={`${botao} border border-slate-300`} onClick={() => setRevisao((valor) => valor + 1)}>
            Tentar novamente
          </button>
        )}
        {carregando && <p role="status" className="text-sm text-slate-600">Carregando mockups…</p>}
        {!carregando && !erroLista && !mockups.length && <p className="text-sm text-slate-600">Nenhum mockup cadastrado.</p>}
        {mockups.length > 0 && (
          <ul className="max-h-72 divide-y divide-slate-200 overflow-y-auto rounded-md border border-slate-200">
            {mockups.map((mockup) => (
              <li key={mockup.id}>
                <button type="button" aria-pressed={selecionado?.id === mockup.id}
                  onClick={() => setSelecionado(mockup)}
                  className="min-h-11 w-full break-words px-3 py-2 text-left text-sm hover:bg-slate-100 focus-visible:outline focus-visible:-outline-offset-2 aria-pressed:bg-slate-100 dark:hover:bg-slate-800 dark:aria-pressed:bg-slate-800">
                  {mockup.nome} · {mockup.tipo === "LAYOUT" ? "Layout" : "Individual"}
                </button>
              </li>
            ))}
          </ul>
        )}
        {cursor && (
          <button type="button" disabled={carregando} onClick={() => void carregarMais()} className={`${botao} border border-slate-300`}>
            Carregar mais
          </button>
        )}
        {selecionado && <VisualizacaoMockup key={selecionado.id} mockup={selecionado} token={token} />}
      </section>
    </div>
  );
}
