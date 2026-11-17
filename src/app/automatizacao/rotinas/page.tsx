"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import type { HorarioRotina } from "@/lib/automatizacao/contrato";
import { botao, Feedback, painel, secundario, TelaAutomatizacao, useAutomatizacaoApi } from "@/components/automatizacao/compartilhado";

const dias = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const horarioNovo = { dia: 1, hora: "08:00" };
const vazio = { id: "", revisao: "", nome: "", habilidadeId: "", ativa: false, horarios: [horarioNovo] as HorarioRotina[] };
type Rotina = typeof vazio & { arquivada: boolean };
type Habilidade = { id: string; nome: string; arquivada: boolean };

export default function RotinasPage() {
  return <TelaAutomatizacao titulo="Rotinas" descricao="Programe execuções semanais ou mensais no horário de São Paulo."><Rotinas /></TelaAutomatizacao>;
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
      const resposta = await api<{ situacao: string }>(`testar-rotina?id=${id}`, "POST");
      setSucesso(resposta.situacao === "EM_EXECUCAO"
        ? "Esta rotina já está executando. Acompanhe no Histórico."
        : resposta.situacao === "REENFILEIRADA"
          ? "Execução com falha reenfileirada para agora, preservando a versão original da habilidade. Acompanhe no Histórico."
          : "Execução na fila para agora. O worker iniciará assim que estiver disponível.");
    } catch (error) { setErro((error as Error).message); }
    finally { setSalvando(false); }
  }

  function salvar(evento: FormEvent) {
    evento.preventDefault();
    void alterar(form.id ? "PATCH" : "POST");
  }

  function editarHorario(index: number, horario: HorarioRotina) {
    setForm({ ...form, horarios: form.horarios.map((item, i) => i === index ? horario : item) });
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
        <p className="text-sm">Use horários de São Paulo com pelo menos 15 minutos de intervalo entre si e em relação às outras rotinas ativas. Essa regra também é conferida ao ativar a rotina.</p>
        <p className="text-sm">Na agenda mensal, o dia escolhido só executa nos meses em que existe. Por exemplo, dia 31 não executa em fevereiro.</p>
        {form.horarios.map((item, index) => <div key={index} className="grid items-end gap-2 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto]">
          <label className="min-w-0 text-sm">Frequência {index + 1}<select className="input mt-1 min-h-11 w-full" value={"diaMes" in item ? "mensal" : "semanal"} onChange={(e) => editarHorario(index, e.target.value === "mensal" ? { diaMes: 1, hora: item.hora } : { dia: 1, hora: item.hora })}>
            <option value="semanal">Semanal</option><option value="mensal">Mensal</option>
          </select></label>
          {"diaMes" in item
            ? <label className="min-w-0 text-sm">Dia do mês {index + 1}<select className="input mt-1 min-h-11 w-full" value={item.diaMes} onChange={(e) => editarHorario(index, { diaMes: Number(e.target.value), hora: item.hora })}>{Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label>
            : <label className="min-w-0 text-sm">Dia da semana {index + 1}<select className="input mt-1 min-h-11 w-full" value={item.dia} onChange={(e) => editarHorario(index, { dia: Number(e.target.value), hora: item.hora })}>{dias.map((dia, i) => <option key={dia} value={i}>{dia}</option>)}</select></label>}
          <label className="min-w-0 text-sm">Horário {index + 1}<input type="time" required className="input mt-1 min-h-11 w-full" value={item.hora} onChange={(e) => editarHorario(index, { ...item, hora: e.target.value })} /></label>
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
      <ul className="flex flex-wrap gap-2 text-sm">{item.horarios.map((horario) => <li key={`${"diaMes" in horario ? `mes-${horario.diaMes}` : `semana-${horario.dia}`}-${horario.hora}`}>{"diaMes" in horario ? `Todo mês, dia ${horario.diaMes}` : dias[horario.dia]} às {horario.hora}</li>)}</ul>
      <div className="flex flex-wrap gap-2"><Link className={`${secundario} inline-flex items-center`} href={`/automatizacao/historico?rotinaId=${encodeURIComponent(item.id)}`} aria-label={`Histórico da rotina ${item.nome}`}>Histórico</Link></div>
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
