"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, LogOut, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import type { PermissionKey } from "@/lib/permissions";
import { hasAnyPermission } from "@/lib/permissions";

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
      { label: "Gerador CSV", href: "/gerador-csv-olist", permissions: ["podeEditarEstoque"] },
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
      { label: "Produtos", href: "/olist/produtos" },
      { label: "Contatos", href: "/olist/contatos" },
      { label: "Pedidos", href: "/olist/pedidos" },
      { label: "Criar pedido", href: "/olist/pedidos/criar" },
      { label: "Vendedores", href: "/olist/vendedores" },
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
        label: "Categorias",
        href: "/controle-midia/categorias",
        permissions: ["podeVisualizarCategoriasMidia"],
      },
    ],
  },
  {
    label: "Configurações",
    href: "/configuracoes",
    permissions: ["podeVisualizarConfiguracao", "podeEditarConfiguracao"],
  },
];

export function Sidebar() {
  const { usuario, user, signOut } = useAuth();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const nomeAplicativo = usuario?.aplicativo?.nome ?? "Aplicativo";

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  function isActive(href: string) {
    return href === "/" ? pathname === href : pathname.startsWith(href);
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
      <div className="mb-8 pr-10 md:pr-0">
        <h1 className="text-lg font-semibold text-slate-900">ERP Shop</h1>
        <p className="mt-1 text-xs text-slate-500">
          {nomeAplicativo}
        </p>
      </div>
      <nav>
        <ul className="space-y-3">
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
      <div className="mt-auto border-t border-slate-200 pt-5">
        <Link
          href="/usuario"
          className={`block min-w-0 rounded-md px-3 py-2 transition hover:bg-slate-100 ${
            isActive("/usuario") ? "bg-slate-100" : ""
          }`}
        >
          <p className="truncate text-sm font-medium text-slate-800">{usuario?.nome ?? user?.email}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{user?.email}</p>
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
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-slate-900">ERP Shop</h1>
          <p className="truncate text-xs text-slate-500">
            {nomeAplicativo}
          </p>
        </div>
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
          <aside className="relative flex h-full w-80 max-w-[85vw] flex-col bg-white p-6 shadow-xl">
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

      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r border-slate-200 bg-white p-6 md:flex">
        {renderSidebarContent()}
      </aside>
    </>
  );
}
