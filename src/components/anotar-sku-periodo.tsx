"use client";
import { hojeSku, periodoSkuSchema, type PeriodoSku } from "@/lib/anotar-sku/periodo";

export function AnotarSkuPeriodo({ periodo, alterar, desabilitado }: { periodo: PeriodoSku; alterar: (periodo: PeriodoSku) => void; desabilitado: boolean }) {
  const validacao = periodoSkuSchema.safeParse(periodo);
  const erros = validacao.success ? [] : validacao.error.issues;
  return <fieldset disabled={desabilitado} className="mt-4 min-w-0 max-w-xl">
    <legend className="text-sm font-medium text-slate-900">Período dos pedidos</legend>
    <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
      <div className="min-w-0"><label htmlFor="sku-periodo-inicio" className="mb-1 block text-sm font-medium text-slate-700">Criados a partir de</label><input id="sku-periodo-inicio" className="input min-h-11 min-w-0" type="date" required max={hojeSku()} value={periodo.periodoInicio} aria-invalid={erros.some(e => e.path[0] === "periodoInicio")} aria-describedby={erros.length ? "sku-periodo-erro" : "sku-periodo-ajuda"} onChange={e => alterar({ ...periodo, periodoInicio: e.target.value })} /></div>
      <div className="min-w-0"><label htmlFor="sku-periodo-fim" className="mb-1 block text-sm font-medium text-slate-700">Criados até</label><input id="sku-periodo-fim" className="input min-h-11 min-w-0" type="date" required min={periodo.periodoInicio || undefined} max={hojeSku()} value={periodo.periodoFim} aria-invalid={erros.some(e => e.path[0] === "periodoFim")} aria-describedby={erros.length ? "sku-periodo-erro" : "sku-periodo-ajuda"} onChange={e => alterar({ ...periodo, periodoFim: e.target.value })} /></div>
    </div>
    {erros.length > 0 && <p id="sku-periodo-erro" role="alert" className="mt-3 text-sm text-red-700">{erros[0].message}</p>}
    <p id="sku-periodo-ajuda" className="mt-2 text-xs text-slate-500">Datas incluídas, no horário de São Paulo.</p>
  </fieldset>;
}
