import { ArrowUpRight } from "lucide-react";

export function LinkBuscaSku({ sku }: { sku: string }) {
  return (
    <a
      href={`https://meuryshop.com.br/search/?q=${encodeURIComponent(sku)}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Buscar ${sku} na Meuryshop (abre em nova aba)`}
      title="Buscar produto na Meuryshop"
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      <ArrowUpRight className="h-5 w-5" aria-hidden="true" />
    </a>
  );
}
