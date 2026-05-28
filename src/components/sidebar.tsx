"use client";

import Link from "next/link";
import { LogOut } from "lucide-react";
import { useAuth } from "@/components/auth-provider";

const menuItems = [
  { label: "Dashboard", href: "/" },
  { label: "Produtos", href: "/produtos" },
  { label: "Gerador CSV Olist", href: "/gerador-csv-olist" },
  { label: "Estoque", href: "/estoque" },
  { label: "Baixa Olist", href: "/baixa-estoque-olist" },
  { label: "Devoluções", href: "/devolucoes" },
  { label: "Solicitações de Produção", href: "/solicitacoes-producao" },
  { label: "Confirmar Produção", href: "/confirmar-producao" },
  { label: "Configurações", href: "/configuracoes" },
];

export function Sidebar() {
  const { usuario, user, signOut } = useAuth();

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white p-6">
      <div className="mb-8">
        <h1 className="text-lg font-semibold text-slate-900">Produção Olist</h1>
        <p className="mt-1 text-xs text-slate-500">
          {usuario?.aplicativo?.nome ?? "Aplicativo associado"}
        </p>
      </div>
      <nav>
        <ul className="space-y-1">
          {menuItems.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="block rounded-md px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-auto border-t border-slate-200 pt-5">
        <p className="truncate text-sm font-medium text-slate-800">{usuario?.nome ?? user?.email}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">{user?.email}</p>
        <button
          type="button"
          onClick={signOut}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sair
        </button>
      </div>
    </aside>
  );
}
