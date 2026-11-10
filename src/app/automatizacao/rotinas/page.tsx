"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { botao, Feedback, painel, secundario, TelaAutomatizacao, useAutomatizacaoApi } from "@/components/automatizacao/compartilhado";

const dias = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const horarioNovo = { dia: 1, hora: "08:00" };
const vazio = { id: "", revisao: "", nome: "", habilidadeId: "", ativa: false, horarios: [horarioNovo] };
type Rotina = typeof vazio & { arquivada: boolean };
type Habilidade = { id: string; nome: string; arquivada: boolean };

export default function RotinasPage() {
  return <TelaAutomatizacao titulo="Rotinas" descricao="Programe execuções semanais no horário de São Paulo."><Rotinas /></TelaAutomatizacao>;
}

function Rotinas() {
  const api = useAutomatizacaoApi();
  const { usuario } = useAuth();
  const [rotinas, setRotinas] = useState<Rotina[]>([]);
  const [habilidades, setHabilidades] = useState<Habilidade[]>([]);
  const campoNome = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(vazio);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const carregar = useCallback(async () => {
    try {
      const [lista, prompts] = await Promise.all([api<Rotina[]>("rotinas"), api<Habilidade[]>("habilidades")]);
      setRotinas(lista);
      setHabilidades(prompts);
    } catch (error) { setErro((error as Error).message); }
    finally { setCarregando(false); }
  }, [api]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function alterar(method: string, rotina = form, ativa?: boolean) {
    setSalvando(true);
    setErro("");
    setSucesso("");
    try {
      const acao = ativa === undefined ? "" : "&acao=status";
      const dados = ativa === undefined ? rotina : { ativa, revisao: rotina.revisao };
      await api(rotina.id ? `rotinas?id=${rotina.id}${acao}` : "rotinas", method, method === "DELETE" ? undefined : dados);
      setForm(vazio);
      setSucesso(method === "DELETE" ? "Rotina arquivada." : "Rotina salva.");
      await carregar();
    } catch (error) { setErro((error as Error).message); await carregar(); }
    finally { setSalvando(false); }
  }

  async function testar(id: string) {
    setSalvando(true);
    setErro("");
    setSucesso("");
    try {
      await api(`testar-rotina?id=${id}`, "POST");
      setSucesso("Execução da habilidade na fila. Se já havia uma em aberto, ela foi mantida. Acompanhe no Histórico.");
    } catch (error) { setErro((error as Error).message); }
    finally { setSalvando(false); }
  }

  function salvar(evento: FormEvent) {
    evento.preventDefault();
    void alterar(form.id ? "PATCH" : "POST");
  }

  function editarHorario(index: number, parcial: Partial<typeof horarioNovo>) {
    setForm({ ...form, horarios: form.horarios.map((item, i) => i === index ? { ...item, ...parcial } : item) });
  }

  return <div className="space-y-4">
    <Feedback {...{ carregando, erro, sucesso }} />
    {usuario?.podeGerenciarRotinas && <form onSubmit={salvar} className={painel}>
      <h2 className="font-semibold">{form.id ? "Editar rotina" : "Nova rotina"}</h2>
      <fieldset disabled={salvando} className="min-w-0 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">Nome<input ref={campoNome} className="input mt-1 min-h-11 w-full" required maxLength={120} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></label>
          <label className="text-sm">Habilidade<select className="input mt-1 min-h-11 w-full" required value={form.habilidadeId} onChange={(e) => setForm({ ...form, habilidadeId: e.target.value })}>
            <option value="">Selecione</option>{habilidades.filter((item) => !item.arquivada).map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
          </select></label>
        </div>
        <p className="text-sm">Tipo: Executar prompt · Destino: WhatsApp configurado no aplicativo</p>
        {form.horarios.map((item, index) => <div key={index} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <label className="text-sm">Dia {index + 1}<select className="input mt-1 min-h-11 w-full" value={item.dia} onChange={(e) => editarHorario(index, { dia: Number(e.target.value) })}>{dias.map((dia, i) => <option key={dia} value={i}>{dia}</option>)}</select></label>
          <label className="text-sm">Horário {index + 1}<input type="time" required className="input mt-1 min-h-11 w-full" value={item.hora} onChange={(e) => editarHorario(index, { hora: e.target.value })} /></label>
          <button type="button" className={secundario} disabled={form.horarios.length === 1} onClick={() => setForm({ ...form, horarios: form.horarios.filter((_, i) => i !== index) })}>Remover horário {index + 1}</button>
        </div>)}
        <button type="button" className={secundario} disabled={form.horarios.length >= 56} onClick={() => setForm({ ...form, horarios: [...form.horarios, horarioNovo] })}>Adicionar horário</button>
        {!form.id && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={form.ativa} onChange={(e) => setForm({ ...form, ativa: e.target.checked })} /> Rotina ativa</label>}
        <div className="flex flex-wrap gap-2">
          <button className={botao} type="submit">Salvar rotina</button>
          {form.id && <button type="button" className={secundario} onClick={() => setForm(vazio)}>Cancelar edição</button>}
        </div>
      </fieldset>
    </form>}
    {!carregando && !rotinas.length && <p>Nenhuma rotina cadastrada.</p>}
    {rotinas.map((item) => <article key={item.id} className={painel}>
      <h2 className="break-words font-semibold">{item.nome}</h2>
      <p className="break-words text-sm">{habilidades.find((h) => h.id === item.habilidadeId)?.nome} · {item.arquivada ? "Arquivada" : item.ativa ? "Ativa" : "Pausada"}</p>
      <ul className="flex flex-wrap gap-2 text-sm">{item.horarios.map(({ dia, hora }) => <li key={`${dia}-${hora}`}>{dias[dia]} {hora}</li>)}</ul>
      {usuario?.podeIntervirAutomatizacao && !item.arquivada && <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={secundario} disabled={salvando} onClick={() => void testar(item.id)}>Testar rotina</button>
        <span className="text-sm">Executa a habilidade real agora, mesmo com a rotina pausada. Pode realizar ações externas e enviar WhatsApp.</span>
      </div>}
      {usuario?.podeGerenciarRotinas && !item.arquivada && <div className="flex flex-wrap gap-2">
        <button className={secundario} disabled={salvando} onClick={() => { setForm(item); campoNome.current?.focus(); }}>Editar</button>
        <button className={secundario} disabled={salvando} onClick={() => void alterar("PATCH", item, !item.ativa)}>{item.ativa ? "Pausar" : "Ativar"}</button>
        <button className={secundario} disabled={salvando} onClick={() => { if (window.confirm(`Arquivar ${item.nome}?`)) void alterar("DELETE", item); }}>Arquivar</button>
      </div>}
    </article>)}
  </div>;
}
