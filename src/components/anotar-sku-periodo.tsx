"use client";
import { hojeSku, periodoPadraoSku, periodoSkuSchema, type PeriodoSku } from "@/lib/anotar-sku/periodo";

export function AnotarSkuPeriodo({ periodo, alterar, desabilitado }: { periodo: PeriodoSku; alterar: (periodo: PeriodoSku) => void; desabilitado: boolean }) {
  const validacao = periodoSkuSchema.safeParse(periodo);
  const erros = validacao.success ? [] : validacao.error.issues;
  return <fieldset disabled={desabilitado} className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-4">
    <legend className="px-1 text-sm font-medium text-slate-900">Período dos SKUs</legend>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-slate-700">Padrão: últimos 15 dias, incluindo hoje.</p>
      <button type="button" onClick={() => alterar(periodoPadraoSku())} className="min-h-11 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:opacity-50">Usar últimos 15 dias</button>
    </div>
    <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
      <div className="min-w-0"><label htmlFor="sku-periodo-inicio" className="mb-1 block text-sm font-medium text-slate-700">Criados a partir de</label><input id="sku-periodo-inicio" className="input min-h-11 min-w-0" type="date" required max={hojeSku()} value={periodo.periodoInicio} aria-invalid={erros.some(e => e.path[0] === "periodoInicio")} aria-describedby={erros.length ? "sku-periodo-erro" : "sku-periodo-ajuda"} onChange={e => alterar({ ...periodo, periodoInicio: e.target.value })} /></div>
      <div className="min-w-0"><label htmlFor="sku-periodo-fim" className="mb-1 block text-sm font-medium text-slate-700">Criados até</label><input id="sku-periodo-fim" className="input min-h-11 min-w-0" type="date" required min={periodo.periodoInicio || undefined} max={hojeSku()} value={periodo.periodoFim} aria-invalid={erros.some(e => e.path[0] === "periodoFim")} aria-describedby={erros.length ? "sku-periodo-erro" : "sku-periodo-ajuda"} onChange={e => alterar({ ...periodo, periodoFim: e.target.value })} /></div>
    </div>
    {erros.length > 0 && <p id="sku-periodo-erro" role="alert" className="mt-3 text-sm text-red-700">{erros[0].message}</p>}
    <p id="sku-periodo-ajuda" className="mt-3 text-xs text-slate-600">As duas datas estão incluídas, no horário de São Paulo. Todos os pedidos das situações selecionadas serão localizados. Os que estiverem fora deste período aparecerão em um alerta e não serão somados aos SKUs.</p>
  </fieldset>;
}
