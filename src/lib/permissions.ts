export const permissionKeys = [
  "podeVisualizarEstoque",
  "podeEditarEstoque",
  "podeVisualizarBaixa",
  "podeSolicitarBaixa",
  "podeVisualizarDevolucao",
  "podeSolicitarDevolucao",
  "podeSolicitarProducao",
  "podeVisualizarProducao",
  "podeConfirmarProducao",
  "podeVisualizarConfiguracao",
  "podeEditarConfiguracao",
] as const;

export type PermissionKey = (typeof permissionKeys)[number];

export type PermissionSet = Record<PermissionKey, boolean>;

export const permissionLabels: Record<PermissionKey, string> = {
  podeVisualizarEstoque: "Visualizar estoque",
  podeEditarEstoque: "Editar estoque",
  podeVisualizarBaixa: "Visualizar baixas",
  podeSolicitarBaixa: "Solicitar baixas",
  podeVisualizarDevolucao: "Visualizar devoluções",
  podeSolicitarDevolucao: "Solicitar devoluções",
  podeSolicitarProducao: "Solicitar produção",
  podeVisualizarProducao: "Visualizar produção",
  podeConfirmarProducao: "Confirmar produção",
  podeVisualizarConfiguracao: "Visualizar configurações",
  podeEditarConfiguracao: "Editar configurações",
};

export function hasAnyPermission(
  usuario: Partial<PermissionSet> | null | undefined,
  permissions: PermissionKey[],
) {
  if (permissions.length === 0) return true;

  return permissions.some((permission) => Boolean(usuario?.[permission]));
}
