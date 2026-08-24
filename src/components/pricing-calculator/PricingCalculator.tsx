"use client";

import { useMemo, useState } from "react";
import { DEFAULT_PERCENTAGES } from "@/lib/marketplaceFees";
import { MarketplacePricing, PricingCalculatorUtils } from "@/lib/pricingCalculator";

type FormState = {
  pricePerMeter: string;
  metersUsed: string;
  extraCosts: string;
  taxesPercentage: string;
  laborPercentage: string;
  profitPercentage: string;
};

const INITIAL_FORM: FormState = {
  pricePerMeter: "16,99",
  metersUsed: "3",
  extraCosts: "0,00",
  taxesPercentage: String(DEFAULT_PERCENTAGES.taxes),
  laborPercentage: String(DEFAULT_PERCENTAGES.labor),
  profitPercentage: String(DEFAULT_PERCENTAGES.profit),
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percentageFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function parseDecimal(value: string) {
  const normalized = value.trim().includes(",")
    ? value.trim().replace(/\./g, "").replace(",", ".")
    : value.trim();
  return normalized === "" ? 0 : Number(normalized);
}

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
    <span className="text-slate-500">{label}</span>
    <span className="text-right font-medium text-slate-800">{value}</span>
  </div>;
}

function ResultCard({ result, isLowest }: { result: MarketplacePricing; isLowest: boolean }) {
  return <article className={`rounded-xl border bg-white p-5 shadow-sm ${isLowest ? "border-emerald-400 ring-2 ring-emerald-100" : "border-slate-200"}`}>
    <div className="flex items-start justify-between gap-3">
      <h2 className="text-lg font-semibold text-slate-900">{result.marketplaceName}</h2>
      {isLowest && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">Menor preço</span>}
    </div>
    <p className="mt-5 text-sm text-slate-500">Preço recomendado</p>
    <p className="mt-1 text-3xl font-bold tracking-tight text-slate-950">{formatCurrency(result.recommendedPrice)}</p>
    <p className="mt-2 text-xs text-slate-500">Mínimo calculado: {formatCurrency(result.minimumPrice)}</p>

    <div className="mt-5 border-t border-slate-200 pt-3">
      <DetailRow label="Custo material" value={formatCurrency(result.materialCost)} />
      <DetailRow label="Gastos extras" value={formatCurrency(result.extraCosts)} />
      <DetailRow label="Custo do produto" value={formatCurrency(result.totalCost)} />
      <DetailRow label="Marketplace" value={formatCurrency(result.marketplaceCost)} />
      <DetailRow label="Taxa percentual" value={`${percentageFormatter.format(result.percentageFee)}%`} />
      <DetailRow label="Taxa fixa" value={formatCurrency(result.fixedFee)} />
      <DetailRow label="Impostos" value={formatCurrency(result.taxes)} />
      <DetailRow label="Trabalho" value={formatCurrency(result.labor)} />
      <DetailRow label="Lucro estimado" value={formatCurrency(result.estimatedProfit)} />
    </div>
    <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
      <span className="font-medium text-slate-600">Margem líquida</span>
      <span className="font-semibold text-slate-900">{percentageFormatter.format(result.netMargin)}%</span>
    </div>
  </article>;
}

export function PricingCalculator() {
  const [form, setForm] = useState(INITIAL_FORM);

  const calculation = useMemo(() => {
    const values = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, parseDecimal(value)])) as Record<keyof FormState, number>;
    const hasInvalidValue = Object.values(values).some((value) => !Number.isFinite(value) || value < 0);
    const totalPercentage = values.taxesPercentage + values.laborPercentage + values.profitPercentage;
    if (hasInvalidValue || values.pricePerMeter <= 0 || values.metersUsed <= 0 || totalPercentage >= 80) return null;

    try {
      return PricingCalculatorUtils.calculateMarketplacePrices(values);
    } catch {
      return null;
    }
  }, [form]);

  const lowestPrice = calculation ? Math.min(...calculation.map((result) => result.recommendedPrice)) : null;

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  const fields: Array<{ key: keyof FormState; label: string; suffix?: string }> = [
    { key: "pricePerMeter", label: "Preço por metro", suffix: "R$" },
    { key: "metersUsed", label: "Quantidade utilizada", suffix: "m" },
    { key: "extraCosts", label: "Gastos extras", suffix: "R$" },
  ];
  const optionalFields: Array<{ key: keyof FormState; label: string }> = [
    { key: "taxesPercentage", label: "Imposto" },
    { key: "laborPercentage", label: "Trabalho" },
    { key: "profitPercentage", label: "Lucro desejado" },
  ];

  return <div className="space-y-6">
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <div className="grid gap-4 md:grid-cols-3">
        {fields.map((field) => <label key={field.key} className="block text-sm font-medium text-slate-700">
          {field.label}
          <div className="relative mt-1.5">
            <input className="input pr-11" inputMode="decimal" value={form[field.key]} onChange={(event) => updateField(field.key, event.target.value)} />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-slate-400">{field.suffix}</span>
          </div>
        </label>)}
      </div>

      <details className="mt-5 border-t border-slate-200 pt-4">
        <summary className="cursor-pointer select-none text-sm font-medium text-slate-700">Percentuais do cálculo</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {optionalFields.map((field) => <label key={field.key} className="block text-sm font-medium text-slate-700">
            {field.label}
            <div className="relative mt-1.5">
              <input className="input pr-9" inputMode="decimal" value={form[field.key]} onChange={(event) => updateField(field.key, event.target.value)} />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-400">%</span>
            </div>
          </label>)}
        </div>
      </details>
    </section>

    {!calculation && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Preencha valores positivos. A soma de imposto, trabalho e lucro deve permitir o cálculo do preço.</div>}

    {calculation && <>
      <div className="grid gap-5 lg:grid-cols-3">
        {calculation.map((result) => <ResultCard key={result.marketplaceId} result={result} isLowest={result.recommendedPrice === lowestPrice} />)}
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-900">Comparação final</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-3">Marketplace</th><th className="px-5 py-3">Preço recomendado</th><th className="px-5 py-3">Taxas</th><th className="px-5 py-3">Lucro</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {calculation.map((result) => <tr key={result.marketplaceId} className={result.recommendedPrice === lowestPrice ? "bg-emerald-50" : ""}>
                <td className="px-5 py-4 font-medium text-slate-900">{result.marketplaceName}{result.recommendedPrice === lowestPrice && <span className="ml-2 text-xs font-semibold text-emerald-700">Menor preço</span>}</td>
                <td className="px-5 py-4 font-semibold text-slate-900">{formatCurrency(result.recommendedPrice)}</td>
                <td className="px-5 py-4 text-slate-600">{formatCurrency(result.marketplaceCost)}</td>
                <td className="px-5 py-4 text-slate-600">{formatCurrency(result.estimatedProfit)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </>}
  </div>;
}
