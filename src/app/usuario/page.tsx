"use client";

import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/components/auth-provider";
import { permissionKeys, permissionLabels } from "@/lib/permissions";

export default function UsuarioPage() {
  const { usuario, user } = useAuth();
  const permissoesAtivas = permissionKeys.filter((permission) => usuario?.[permission]);
  const nomeAplicativo = usuario?.aplicativo?.nome ?? "Aplicativo";

  return (
    <div className="space-y-8">
      <PageHeader
        title="Meu usuário"
        description="Consulte os dados do usuário logado e as permissões liberadas para esta conta."
      />

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Dados do usuário</h3>
        <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase text-slate-500">Nome</dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">
              {usuario?.nome ?? "Nome não informado"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-slate-500">E-mail</dt>
            <dd className="mt-1 break-all text-sm font-medium text-slate-900">
              {usuario?.email ?? user?.email ?? "E-mail não informado"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-slate-500">Aplicativo</dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">
              {nomeAplicativo}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Permissões</h3>
          <span className="text-sm text-slate-600">
            {permissoesAtivas.length} de {permissionKeys.length}
          </span>
        </div>

        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {permissionKeys.map((permission) => {
            const ativa = Boolean(usuario?.[permission]);

            return (
              <li
                key={permission}
                className={`rounded-md border px-3 py-2 text-sm font-medium ${
                  ativa
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-red-200 bg-red-50 text-red-700"
                }`}
              >
                {permissionLabels[permission]}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
