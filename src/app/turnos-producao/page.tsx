"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/lib/supabase";

type Turno = {
  id: string;
  hora_inicio: string;
  hora_fim: string;
  inicia_dia_anterior: boolean;
  ativo: boolean;
  created_at: string;
  updated_at: string;
};

type FormState = {
  hora_inicio: string;
  hora_fim: string;
  inicia_dia_anterior: boolean;
  ativo: boolean;
};

const INITIAL_FORM: FormState = {
  hora_inicio: "",
  hora_fim: "",
  inicia_dia_anterior: false,
  ativo: true,
};

export default function TurnosProducaoPage() {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);

  const isEditing = useMemo(() => Boolean(editingId), [editingId]);

  async function carregarTurnos() {
    setLoading(true);
    setMessage(null);

    const { data, error } = await supabase
      .from("turnos_producao")
      .select("id, hora_inicio, hora_fim, inicia_dia_anterior, ativo, created_at, updated_at")
      .order("id", { ascending: true });

    if (error) {
      setMessage(`Erro ao carregar turnos: ${error.message}`);
    } else {
      setTurnos((data as Turno[]) ?? []);
    }

    setLoading(false);
  }

  useEffect(() => {
    carregarTurnos();
  }, []);

  function resetarFormulario() {
    setEditingId(null);
    setForm(INITIAL_FORM);
  }

  function editarTurno(turno: Turno) {
    setEditingId(turno.id);
    setForm({
      hora_inicio: turno.hora_inicio,
      hora_fim: turno.hora_fim,
      inicia_dia_anterior: turno.inicia_dia_anterior,
      ativo: turno.ativo,
    });
    setMessage(null);
  }

  async function salvarTurno(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);

    if (!form.hora_inicio || !form.hora_fim) {
      setMessage("Informe hora inicial e hora final.");
      setSaving(false);
      return;
    }

    const payload = {
      hora_inicio: form.hora_inicio,
      hora_fim: form.hora_fim,
      inicia_dia_anterior: form.inicia_dia_anterior,
      ativo: form.ativo,
    };

    const { error } = editingId
      ? await supabase.from("turnos_producao").update(payload).eq("id", editingId)
      : await supabase.from("turnos_producao").insert(payload);

    if (error) {
      setMessage(`Erro ao salvar turno: ${error.message}`);
    } else {
      setMessage(isEditing ? "Turno atualizado com sucesso." : "Turno criado com sucesso.");
      resetarFormulario();
      await carregarTurnos();
    }

    setSaving(false);
  }

  async function alternarStatus(turno: Turno) {
    setMessage(null);
    const { error } = await supabase
      .from("turnos_producao")
      .update({ ativo: !turno.ativo })
      .eq("id", turno.id);

    if (error) {
      setMessage(`Erro ao alterar status: ${error.message}`);
      return;
    }

    setMessage(`Turno ${turno.ativo ? "desativado" : "ativado"} com sucesso.`);
    await carregarTurnos();
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Turnos de Produção"
        description="Cadastre e mantenha os turnos ativos para operação da fábrica."
      />

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">{isEditing ? "Editar turno" : "Novo turno"}</h3>

        <form className="grid gap-4 md:grid-cols-2" onSubmit={salvarTurno}>
          <label className="block text-sm text-slate-700">
            Hora inicial
            <input
              type="time"
              required
              value={form.hora_inicio}
              onChange={(event) => setForm((prev) => ({ ...prev, hora_inicio: event.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="block text-sm text-slate-700">
            Hora final
            <input
              type="time"
              required
              value={form.hora_fim}
              onChange={(event) => setForm((prev) => ({ ...prev, hora_fim: event.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.inicia_dia_anterior}
              onChange={(event) => setForm((prev) => ({ ...prev, inicia_dia_anterior: event.target.checked }))}
            />
            Inicia no dia anterior
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={(event) => setForm((prev) => ({ ...prev, ativo: event.target.checked }))}
            />
            Ativo
          </label>

          <div className="md:col-span-2 flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Salvando..." : isEditing ? "Salvar alterações" : "Criar turno"}
            </button>

            {isEditing && (
              <button
                type="button"
                onClick={resetarFormulario}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Cancelar edição
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Lista de turnos</h3>

        {loading ? (
          <p className="text-sm text-slate-600">Carregando...</p>
        ) : turnos.length === 0 ? (
          <p className="text-sm text-slate-600">Nenhum turno cadastrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Hora inicial</th>
                  <th className="px-3 py-2 text-left font-medium">Hora final</th>
                  <th className="px-3 py-2 text-left font-medium">Inicia dia anterior</th>
                  <th className="px-3 py-2 text-left font-medium">Ativo</th>
                  <th className="px-3 py-2 text-left font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {turnos.map((turno) => (
                  <tr key={turno.id}>
                    <td className="px-3 py-2">{turno.hora_inicio.slice(0, 5)}</td>
                    <td className="px-3 py-2">{turno.hora_fim.slice(0, 5)}</td>
                    <td className="px-3 py-2">{turno.inicia_dia_anterior ? "Sim" : "Não"}</td>
                    <td className="px-3 py-2">{turno.ativo ? "Ativo" : "Inativo"}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => editarTurno(turno)}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => alternarStatus(turno)}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700"
                        >
                          {turno.ativo ? "Desativar" : "Ativar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {message && <p className="mt-4 text-sm text-slate-700">{message}</p>}
      </section>
    </div>
  );
}
