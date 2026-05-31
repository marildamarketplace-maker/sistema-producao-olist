"use client";

import type { PermissionKey } from "@/lib/permissions";
import { hasAnyPermission } from "@/lib/permissions";
import { useAuth } from "@/components/auth-provider";

type AccessGuardProps = {
  children: React.ReactNode;
  permissions: PermissionKey[];
  title?: string;
};

export function AccessGuard({
  children,
  permissions,
  title = "Acesso não autorizado",
}: AccessGuardProps) {
  const { usuario } = useAuth();

  if (hasAnyPermission(usuario, permissions)) {
    return <>{children}</>;
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm text-slate-600">
        Seu usuário não possui permissão para acessar esta página.
      </p>
    </section>
  );
}
