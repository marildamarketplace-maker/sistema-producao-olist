import type { ReactNode } from "react";
interface PageHeaderProps {
  actions?: ReactNode;
  title: string;
  description: string;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-8 rounded-lg border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1">
      <h2 className="text-2xl font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm text-slate-600">{description}</p></div>{actions && <div className="shrink-0">{actions}</div>}</div>
    </header>
  );
}
