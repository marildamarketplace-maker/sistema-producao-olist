import { hasAnyPermission, type PermissionKey, type PermissionSet } from "./permissions";

export type MenuLink = {
  label: string;
  href: string;
  permissions?: PermissionKey[];
};

type MenuGroup = {
  label: string;
  items: MenuLink[];
};

export type MenuItem = MenuLink | MenuGroup;

export const menuItems: MenuItem[] = [
  { label: "Dashboard", href: "/dashboard", permissions: ["podeVisualizarDashboard"] },
  {
    label: "Produtos",
    items: [
      {
        label: "Lista",
        href: "/produtos",
        permissions: ["podeVisualizarEstoque", "podeEditarEstoque"],
      },
      {
        label: "Estoque",
        href: "/estoque",
        permissions: ["podeVisualizarEstoque", "podeEditarEstoque"],
      },
      { label: "Gerador CSV Olist", href: "/gerador-csv-olist", permissions: ["podeEditarEstoque"] },
      {
        label: "Calculadora de Preços",
        href: "/produtos/calculadora-precos",
        permissions: ["podeVisualizarEstoque", "podeEditarEstoque"],
      },
      {
        label: "Tipos de Produto",
        href: "/produtos/tipos",
        permissions: ["podeVisualizarTiposProduto", "podeEditarTiposProduto"],
      },
      {
        label: "Tamanho",
        href: "/produtos/tamanhos",
        permissions: ["podeVisualizarTamanhos", "podeEditarTamanhos"],
      },
      {
        label: "Estampas",
        href: "/produtos/estampas",
        permissions: ["podeVisualizarEstampas", "podeEditarEstampas"],
      },
      {
        label: "Variantes",
        href: "/produtos/variantes",
        permissions: ["podeVisualizarVariantes", "podeEditarVariantes"],
      },
    ],
  },
  {
    label: "Pedidos",
    items: [
      {
        label: "Anotar produção",
        href: "/solicitacoes-producao",
        permissions: ["podeSolicitarProducao", "podeVisualizarProducao"],
      },
      {
        label: "Anotar SKU",
        href: "/anotar-sku",
        permissions: ["podeEscreverAnotarSku", "podeVisualizarAnotarSku"],
      },
      {
        label: "Confirmar entrada",
        href: "/confirmar-producao",
        permissions: ["podeConfirmarProducao"],
      },
      {
        label: "Anotar saída",
        href: "/baixa-estoque-olist",
        permissions: ["podeVisualizarBaixa", "podeSolicitarBaixa"],
      },
      {
        label: "Anotar devolução",
        href: "/devolucoes",
        permissions: ["podeVisualizarDevolucao", "podeSolicitarDevolucao"],
      },
    ],
  },
  {
    label: "Olist",
    items: [
      { label: "Produtos", href: "/olist/produtos", permissions: ["podeVisualizarOlistProdutos"] },
      { label: "Contatos", href: "/olist/contatos", permissions: ["podeVisualizarOlistContatos"] },
      { label: "Pedidos", href: "/olist/pedidos", permissions: ["podeVisualizarOlistPedidos"] },
      { label: "Criar pedido", href: "/olist/pedidos/criar", permissions: ["podeCriarOlistPedido"] },
      { label: "Formas de pagamento", href: "/olist/formas-pagamento", permissions: ["podeVisualizarOlistFormasPagamento"] },
      { label: "Formas de recebimento", href: "/olist/formas-recebimento", permissions: ["podeVisualizarOlistFormasRecebimento"] },
      { label: "Vendedores", href: "/olist/vendedores", permissions: ["podeVisualizarOlistVendedores"] },
    ],
  },
  {
    label: "Fornecedor",
    items: [
      {
        label: "Fornecedores",
        href: "/fornecedor/fornecedores",
        permissions: ["podeVisualizarFornecedores"],
      },
      {
        label: "Produtos",
        href: "/fornecedor/produtos",
        permissions: ["podeVisualizarProdutosFornecedor"],
      },
    ],
  },
  {
    label: "Controle de mídia",
    items: [
      {
        label: "Produtos",
        href: "/controle-midia/produtos",
        permissions: ["podeVisualizarCategoriasMidia"],
      },
      {
        label: "Categorias",
        href: "/controle-midia/categorias",
        permissions: ["podeVisualizarCategoriasMidia"],
      },
      {
        label: "Gestão de Tarefas",
        href: "/controle-midia/tarefas",
        permissions: ["podeVisualizarTarefasMidia"],
      },
      {
        label: "Pesquisar estampas",
        href: "/controle-midia/estampas",
        permissions: ["podeVisualizarEstampas", "podeEditarEstampas"],
      },
      {
        label: "Jobs de IA",
        href: "/controle-midia/estampas/jobs",
        permissions: ["podeVisualizarEstampas", "podeEditarEstampas"],
      },
    ],
  },
  {
    label: "Configurações",
    href: "/configuracoes",
    permissions: ["podeVisualizarConfiguracao", "podeEditarConfiguracao"],
  },
  { label: "Usuários", href: "/usuarios", permissions: ["podeEditarConfiguracao"] },
];


export const paginas = menuItems.flatMap((item) => "href" in item
  ? [{ ...item, grupo: "Geral" }]
  : item.items.map((link) => ({ ...link, grupo: item.label })))
  .concat([
    { label: "Meu usuário", href: "/usuario", grupo: "Conta" },
    { label: "Turnos de produção", href: "/turnos-producao", grupo: "Configurações", permissions: ["podeVisualizarConfiguracao", "podeEditarConfiguracao"] },
  ]);

export function paginasPermitidas(usuario: Partial<PermissionSet>) {
  return paginas.filter((pagina) => hasAnyPermission(usuario, pagina.permissions ?? []));
}

export type ContagemPagina = { pagina: string; acessos: number };
export function rankingPaginas(usuario: Partial<PermissionSet>, contagens: ContagemPagina[]) {
  const contagem = new Map(contagens.map((item) => [item.pagina, item.acessos]));
  return paginasPermitidas(usuario).map((pagina) => ({ ...pagina, acessos: contagem.get(pagina.href) ?? 0 }))
    .sort((a, b) => b.acessos - a.acessos || a.grupo.localeCompare(b.grupo, "pt-BR") || a.label.localeCompare(b.label, "pt-BR"));
}
