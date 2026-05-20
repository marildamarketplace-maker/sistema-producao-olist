import Link from "next/link";

const menuItems = [
  { label: "Dashboard", href: "/" },
  { label: "Produtos", href: "/produtos" },
  { label: "Estoque", href: "/estoque" },
  { label: "Baixa Olist", href: "/baixa-estoque-olist" },
  { label: "Devoluções", href: "/devolucoes" },
  { label: "Solicitações de Produção", href: "/solicitacoes-producao" },
  { label: "Confirmar Produção", href: "/confirmar-producao" },
  { label: "Configurações", href: "/configuracoes" },
];

export function Sidebar() {
  return (
    <aside className="w-72 shrink-0 border-r border-slate-200 bg-white p-6">
      <h1 className="mb-8 text-lg font-semibold text-slate-900">Produção Olist</h1>
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
    </aside>
  );
}
