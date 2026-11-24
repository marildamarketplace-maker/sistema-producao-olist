export const permissionKeys = [
  "podeVisualizarDashboard",
  "podeVisualizarFornecedores",
  "podeVisualizarProdutosFornecedor",
  "podeVisualizarCategoriasMidia",
  "podeVisualizarTarefasMidia",
  "podeVisualizarAutomatizacao",
  "podeEditarHabilidades",
  "podeGerenciarRotinas",
  "podeIntervirAutomatizacao",
  "podeVisualizarOlistProdutos",
  "podeVisualizarOlistContatos",
  "podeVisualizarOlistPedidos",
  "podeCriarOlistPedido",
  "podeVisualizarOlistVendedores",
  "podeVisualizarOlistFormasPagamento",
  "podeVisualizarOlistFormasRecebimento",
  "podeVisualizarSincronizacaoOlist",
  "podeExecutarSincronizacaoOlist",
  "podeResolverSincronizacaoOlist",
  "podeConfigurarSincronizacaoOlist",
  "podeVisualizarEstoque",
  "podeEditarEstoque",
  "podeVisualizarTiposProduto",
  "podeEditarTiposProduto",
  "podeVisualizarTamanhos",
  "podeEditarTamanhos",
  "podeVisualizarEstampas",
  "podeEditarEstampas",
  "podeCriarMockups",
  "podeVisualizarVariantes",
  "podeEditarVariantes",
  "podeVisualizarBaixa",
  "podeSolicitarBaixa",
  "podeVisualizarDevolucao",
  "podeSolicitarDevolucao",
  "podeSolicitarProducao",
  "podeVisualizarProducao",
  "podeConfirmarProducao",
  "podeEscreverAnotarSku",
  "podeVisualizarAnotarSku",
  "podeVisualizarConfiguracao",
  "podeEditarConfiguracao",
  "podeGerenciarFilaPedidos",
  "podeSelecionarFilialFornecedor",
] as const;

export type PermissionKey = (typeof permissionKeys)[number];

export type PermissionSet = Record<PermissionKey, boolean>;

export const permissionLabels: Record<PermissionKey, string> = {
  podeVisualizarDashboard: "Visualizar dashboard",
  podeVisualizarFornecedores: "Visualizar fornecedores",
  podeVisualizarProdutosFornecedor: "Visualizar produtos do fornecedor",
  podeVisualizarCategoriasMidia: "Visualizar mídias e mockups",
  podeVisualizarTarefasMidia: "Visualizar calendário comercial",
  podeVisualizarAutomatizacao: "Visualizar automatização",
  podeEditarHabilidades: "Editar habilidades",
  podeGerenciarRotinas: "Gerenciar rotinas",
  podeIntervirAutomatizacao: "Retentar execuções de automatização",
  podeVisualizarOlistProdutos: "Visualizar produtos da Olist",
  podeVisualizarOlistContatos: "Visualizar contatos da Olist",
  podeVisualizarOlistPedidos: "Visualizar pedidos da Olist",
  podeCriarOlistPedido: "Criar pedido na Olist",
  podeVisualizarOlistVendedores: "Visualizar vendedores da Olist",
  podeVisualizarOlistFormasPagamento: "Visualizar formas de pagamento da Olist",
  podeVisualizarOlistFormasRecebimento: "Visualizar formas de recebimento da Olist",
  podeVisualizarSincronizacaoOlist: "Visualizar sincronização Olist (aplicativo pai)",
  podeExecutarSincronizacaoOlist: "Executar sincronização Olist (aplicativo pai)",
  podeResolverSincronizacaoOlist: "Resolver divergências e declarar origem Olist (aplicativo pai)",
  podeConfigurarSincronizacaoOlist: "Configurar sincronização Olist (aplicativo pai)",
  podeVisualizarEstoque: "Visualizar estoque",
  podeEditarEstoque: "Editar estoque",
  podeVisualizarTiposProduto: "Visualizar tipos de produto",
  podeEditarTiposProduto: "Editar tipos de produto",
  podeVisualizarTamanhos: "Visualizar tamanhos",
  podeEditarTamanhos: "Editar tamanhos",
  podeVisualizarEstampas: "Visualizar estampas",
  podeEditarEstampas: "Editar estampas",
  podeCriarMockups: "Selecionar estampas e criar mockups",
  podeVisualizarVariantes: "Visualizar variantes",
  podeEditarVariantes: "Editar variantes",
  podeVisualizarBaixa: "Visualizar baixas",
  podeSolicitarBaixa: "Solicitar baixas",
  podeVisualizarDevolucao: "Visualizar devoluções",
  podeSolicitarDevolucao: "Solicitar devoluções",
  podeSolicitarProducao: "Solicitar produção",
  podeVisualizarProducao: "Visualizar produção",
  podeConfirmarProducao: "Confirmar produção",
  podeEscreverAnotarSku: "Anotar SKU - buscar (write)",
  podeVisualizarAnotarSku: "Anotar SKU - histórico (read)",
  podeVisualizarConfiguracao: "Visualizar configurações",
  podeEditarConfiguracao: "Editar configurações",
  podeGerenciarFilaPedidos: "Gerenciar fila de pedidos",
  podeSelecionarFilialFornecedor: "Selecionar aplicativo destinatário ao enviar para fila",
};

export function hasAnyPermission(
  usuario: Partial<PermissionSet> | null | undefined,
  permissions: PermissionKey[],
) {
  if (permissions.length === 0) return true;

  return permissions.some((permission) => Boolean(usuario?.[permission]));
}

export const syncPermissionKeys = [
  "podeVisualizarSincronizacaoOlist", "podeExecutarSincronizacaoOlist",
  "podeResolverSincronizacaoOlist", "podeConfigurarSincronizacaoOlist",
] as const satisfies readonly PermissionKey[];

export function permissoesSincronizacaoParaAplicativo(
  usuario: Partial<PermissionSet>, aplicativoAdministraGrupo: boolean,
): Pick<PermissionSet, (typeof syncPermissionKeys)[number]> {
  return {
    podeVisualizarSincronizacaoOlist: aplicativoAdministraGrupo && usuario.podeVisualizarSincronizacaoOlist === true,
    podeExecutarSincronizacaoOlist: aplicativoAdministraGrupo && usuario.podeExecutarSincronizacaoOlist === true,
    podeResolverSincronizacaoOlist: aplicativoAdministraGrupo && usuario.podeResolverSincronizacaoOlist === true,
    podeConfigurarSincronizacaoOlist: aplicativoAdministraGrupo && usuario.podeConfigurarSincronizacaoOlist === true,
  };
}
