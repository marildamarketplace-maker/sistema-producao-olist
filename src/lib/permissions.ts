export const permissionKeys = [
  "podeVisualizarDashboard",
  "podeVisualizarFornecedores",
  "podeVisualizarProdutosFornecedor",
  "podeVisualizarCategoriasMidia",
  "podeVisualizarTarefasMidia",
  "podeVisualizarOlistProdutos",
  "podeVisualizarOlistContatos",
  "podeVisualizarOlistPedidos",
  "podeCriarOlistPedido",
  "podeVisualizarOlistVendedores",
  "podeVisualizarOlistFormasPagamento",
  "podeVisualizarOlistFormasRecebimento",
  "podeVisualizarEstoque",
  "podeEditarEstoque",
  "podeVisualizarTiposProduto",
  "podeEditarTiposProduto",
  "podeVisualizarTamanhos",
  "podeEditarTamanhos",
  "podeVisualizarEstampas",
  "podeEditarEstampas",
  "podeVisualizarVariantes",
  "podeEditarVariantes",
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
  podeVisualizarDashboard: "Visualizar dashboard",
  podeVisualizarFornecedores: "Visualizar fornecedores",
  podeVisualizarProdutosFornecedor: "Visualizar produtos do fornecedor",
  podeVisualizarCategoriasMidia: "Visualizar categorias e mídias",
  podeVisualizarTarefasMidia: "Visualizar gestão de tarefas de mídia",
  podeVisualizarOlistProdutos: "Visualizar produtos da Olist",
  podeVisualizarOlistContatos: "Visualizar contatos da Olist",
  podeVisualizarOlistPedidos: "Visualizar pedidos da Olist",
  podeCriarOlistPedido: "Criar pedido na Olist",
  podeVisualizarOlistVendedores: "Visualizar vendedores da Olist",
  podeVisualizarOlistFormasPagamento: "Visualizar formas de pagamento da Olist",
  podeVisualizarOlistFormasRecebimento: "Visualizar formas de recebimento da Olist",
  podeVisualizarEstoque: "Visualizar estoque",
  podeEditarEstoque: "Editar estoque",
  podeVisualizarTiposProduto: "Visualizar tipos de produto",
  podeEditarTiposProduto: "Editar tipos de produto",
  podeVisualizarTamanhos: "Visualizar tamanhos",
  podeEditarTamanhos: "Editar tamanhos",
  podeVisualizarEstampas: "Visualizar estampas",
  podeEditarEstampas: "Editar estampas",
  podeVisualizarVariantes: "Visualizar variantes",
  podeEditarVariantes: "Editar variantes",
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
