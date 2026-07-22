"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, LogOut, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import type { PermissionKey } from "@/lib/permissions";
import { hasAnyPermission } from "@/lib/permissions";
import { useTheme } from "@/components/theme-provider";

type MenuLink = {
  label: string;
  href: string;
  permissions?: PermissionKey[];
};

type MenuGroup = {
  label: string;
  items: MenuLink[];
};

type MenuItem = MenuLink | MenuGroup;

const menuItems: MenuItem[] = [
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
    ],
  },
  {
    label: "Configurações",
    href: "/configuracoes",
    permissions: ["podeVisualizarConfiguracao", "podeEditarConfiguracao"],
  },
  { label: "Usuários", href: "/usuarios", permissions: ["podeEditarConfiguracao"] },
];

export function Sidebar() {
  const { usuario, user, signOut } = useAuth();
  const { isDarkMode, toggleDarkMode } = useTheme();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const nomeAplicativo = usuario?.aplicativo?.nome ?? "Aplicativo";

  async function hardRefresh() {
    if ("caches" in window) {
      const cacheNames = await window.caches.keys();
      await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
    }
    window.location.reload();
  }

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  function isActive(href: string) {
    return pathname === href;
  }

  function linkClassName(href: string, nested = false) {
    const active = isActive(href);
    const base =
      "block rounded-md px-3 py-2 text-sm transition hover:bg-slate-100 hover:text-slate-900";
    const color = active
      ? "bg-slate-900 font-medium text-white hover:bg-slate-900 hover:text-white"
      : "text-slate-700";

    return `${base} ${color} ${nested ? "pl-5" : ""}`;
  }

  function canShowLink(item: MenuLink) {
    return !item.permissions || hasAnyPermission(usuario, item.permissions);
  }

  const visibleMenuItems = menuItems
    .map((item) => {
      if ("href" in item) return canShowLink(item) ? item : null;

      const items = item.items.filter(canShowLink);
      return items.length > 0 ? { ...item, items } : null;
    })
    .filter((item): item is MenuItem => item !== null);

  const renderSidebarContent = () => (
    <>
      <button
        type="button"
        onClick={() => void hardRefresh()}
        title="Recarregar página"
        className="mb-5 shrink-0 rounded-md pr-10 text-left transition hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 md:pr-0"
      >
        <h1 className="text-lg font-semibold text-slate-900">ERP Shop</h1>
        <p className="mt-1 text-xs text-slate-500">
          {nomeAplicativo}
        </p>
      </button>
      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2 [scrollbar-gutter:stable]">
        <ul className="space-y-3 pb-3">
          {visibleMenuItems.map((item) => (
            <li key={item.label}>
              {"href" in item ? (
                <Link href={item.href} className={linkClassName(item.href)}>
                  {item.label}
                </Link>
              ) : (
                <div>
                  <p className="px-3 text-xs font-semibold uppercase text-slate-500">
                    {item.label}
                  </p>
                  <ul className="mt-1 space-y-1 border-l border-slate-200 pl-2">
                    {item.items.map((subItem) => (
                      <li key={subItem.href}>
                        <Link href={subItem.href} className={linkClassName(subItem.href, true)}>
                          {subItem.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-4 shrink-0 border-t border-slate-200 pt-4">
        <div className="mb-3 flex items-center justify-between rounded-md px-3 py-2">
          <span className="text-sm font-medium text-slate-700">{isDarkMode ? "Dark mode ativo" : "Dark mode inativo"}</span>
          <button type="button" role="switch" aria-checked={isDarkMode} aria-label="Alternar dark mode" onClick={toggleDarkMode} className={`theme-switch relative h-7 w-12 rounded-full transition ${isDarkMode ? "is-active" : ""}`}><span className={`theme-switch-thumb absolute top-1 h-5 w-5 rounded-full shadow transition ${isDarkMode ? "left-6" : "left-1"}`} /></button>
        </div>
        <Link
          href="/usuario"
          className={`block min-w-0 rounded-md px-3 py-2 transition hover:bg-slate-100 ${
            isActive("/usuario") ? "bg-slate-100" : ""
          }`}
        >
          <p className="truncate text-sm font-medium text-slate-800">{usuario?.nome ?? user?.email}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{user?.email}</p>
          {usuario?.vendedorOlistId && <p className="mt-1 truncate text-xs text-slate-500">Vendedor Olist: {usuario.vendedorOlistId}</p>}
        </Link>
        <button
          type="button"
          onClick={signOut}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sair
        </button>
      </div>
    </>
  );

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <button type="button" onClick={() => void hardRefresh()} title="Recarregar página" className="min-w-0 rounded-md text-left transition hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">
          <h1 className="truncate text-base font-semibold text-slate-900">ERP Shop</h1>
          <p className="truncate text-xs text-slate-500">
            {nomeAplicativo}
          </p>
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-300 text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
          aria-label="Abrir menu"
          aria-expanded={isOpen}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>

      {isOpen ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 h-full w-full bg-slate-950/40"
            aria-label="Fechar menu"
            onClick={() => setIsOpen(false)}
          />
          <aside className="relative flex h-full w-80 max-w-[85vw] flex-col overflow-hidden bg-white p-6 shadow-xl">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
            {renderSidebarContent()}
          </aside>
        </div>
      ) : null}

      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white p-6 md:flex">
        {renderSidebarContent()}
      </aside>
    </>
  );
}
