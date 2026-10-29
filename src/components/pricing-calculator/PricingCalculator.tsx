"use client";

import { useMemo, useState } from "react";
import { calculateAdvertisingScenarios } from "@/lib/advertisingReturn";
import { calculateKitPrices, EMPTY_KIT_OPTIONS, KitOptions } from "@/lib/kitPricing";
import { SalesChannelId } from "@/lib/marketplaceFees";
import { DEFAULT_PERCENTAGES } from "@/lib/marketplaceFees";
import { MarketplacePricing, PricingCalculatorUtils, PricingInput } from "@/lib/pricingCalculator";

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

type KitFormState = Record<keyof KitOptions, string>;
const KIT_CHANNELS = [
  { id: "shopee", name: "Shopee" },
  { id: "mercadoLivre", name: "Mercado Livre Premium" },
  { id: "tiktokShop", name: "TikTok Shop" },
] as const;
const KIT_FIELDS: Array<{ key: keyof KitOptions; label: string; tiktokOnly?: boolean }> = [
  { key: "shipping", label: "Frete pago por você por kit (R$)" },
  { key: "advertisingPercentage", label: "Reserva para anúncios (%)" },
  { key: "affiliatePercentage", label: "Comissão de afiliados (%)", tiktokOnly: true },
  { key: "shippingPercentage", label: "Programa de envio (%)", tiktokOnly: true },
];
const INITIAL_KIT_FORM: KitFormState = {
  shipping: "0", advertisingPercentage: "0", affiliatePercentage: "0", shippingPercentage: "0",
};

function KitSimulation({ input, channelId, options }: { input: PricingInput; channelId: SalesChannelId; options: KitFormState }) {
  const ownDomain = channelId === "dominioProprio";
  const simulation = useMemo(() => {
    try {
      const values = Object.fromEntries(Object.entries(options).map(([key, value]) => [key, parseDecimal(value)])) as KitOptions;
      return calculateKitPrices(input, channelId, ownDomain ? EMPTY_KIT_OPTIONS : values);
    } catch {
      return null;
    }
  }, [input, channelId, options, ownDomain]);
  return <details className="mt-5 min-w-0 border-t border-slate-200 pt-4">
    <summary className="min-h-11 cursor-pointer rounded-md py-3 text-sm font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">Preço recomendado para kits</summary>
    <p className="mt-2 text-xs text-slate-600">Metragem por peça × quantidade do kit. Gastos extras são por kit, sem multiplicar. Taxas recalculadas pelo preço final do kit. A meta de lucro por peça tem redução de 5% no kit de 2, 10% no de 3 e 15% no de 5, em relação à venda avulsa nas mesmas condições. A margem desejada e o arredondamento podem elevar o lucro final.</p>
    <p className="mt-3 text-xs text-slate-600">{ownDomain ? "Sem taxas de marketplace ou reserva para anúncios." : "Configure os custos em Percentuais do cálculo, no início da tela; zero significa que o custo não será considerado. Lucro desejado preservado após a reserva para anúncios. As taxas são as cadastradas na calculadora; confirme as condições do anúncio."}</p>
    {!simulation ? <p role="alert" className="mt-3 text-sm text-red-700">Não foi possível calcular os kits. Revise os custos e reduza os percentuais; a soma das taxas e margens deve ser menor que 100%.</p> : <div className="mt-4 space-y-3" aria-live="polite">
      {simulation.map(kit => <details key={kit.quantity} className="rounded-md border border-slate-200 p-3">
        <summary className="min-h-11 cursor-pointer rounded-md py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">
          <span className="font-semibold">Kit de {kit.quantity} — {formatCurrency(kit.recommendedPrice)}</span>
          <span className="mt-1 block text-xs text-slate-600">{formatCurrency(kit.unitPrice)} por peça · Lucro total {formatCurrency(kit.estimatedProfit)} · Lucro por peça {formatCurrency(kit.profitPerUnit)}</span>
        </summary>
        <div className="mt-3 border-t border-slate-200 pt-3">
          <DetailRow label="Redução na meta de lucro por peça" value={`${kit.profitReductionPercentage}%`} />
          <DetailRow label="Meta de lucro por peça" value={formatCurrency(kit.targetProfitPerUnit)} />
          <DetailRow label="Mínimo calculado" value={formatCurrency(kit.minimumPrice)} />
          <DetailRow label="Custo material" value={formatCurrency(kit.materialCost)} />
          <DetailRow label="Gastos extras por kit" value={formatCurrency(kit.extraCosts)} />
          {!ownDomain && <>
            <DetailRow label="Frete por kit" value={formatCurrency(kit.shipping)} />
            <DetailRow label="Taxas de marketplace" value={formatCurrency(kit.marketplaceCost)} />
            <DetailRow label="Taxa percentual" value={`${percentageFormatter.format(kit.percentageFee)}%`} />
            <DetailRow label="Taxa fixa" value={formatCurrency(kit.fixedFee)} />
            {channelId === "tiktokShop" && <>
              <DetailRow label="Afiliados" value={formatCurrency(kit.affiliates)} />
              <DetailRow label="Programa de envio" value={formatCurrency(kit.shippingService)} />
            </>}
            <DetailRow label="Reserva para anúncios" value={formatCurrency(kit.advertising)} />
          </>}
          <DetailRow label="Impostos" value={formatCurrency(kit.taxes)} />
          <DetailRow label="Trabalho" value={formatCurrency(kit.labor)} />
          <DetailRow label={ownDomain ? "Lucro antes de anúncios" : "Lucro após reserva para anúncios"} value={formatCurrency(kit.estimatedProfit)} />
          <DetailRow label="Margem de lucro" value={`${percentageFormatter.format(kit.netMargin)}%`} />
        </div>
      </details>)}
    </div>}
  </details>;
}

function ResultCard({ result, isLowest, input, kitOptions }: { result: MarketplacePricing; isLowest: boolean; input: PricingInput; kitOptions: KitFormState }) {
  const isOwnDomain = result.marketplaceId === "dominioProprio";
  const scenarios = calculateAdvertisingScenarios(result);
  const metric = result.marketplaceId === "tiktokShop" ? "ROI" : "ROAS";
  return <article className={`rounded-xl border bg-white p-5 shadow-sm ${isLowest ? "border-emerald-400 ring-2 ring-emerald-100" : "border-slate-200"}`}>
    <div className="flex items-start justify-between gap-3">
      <h2 className="text-lg font-semibold text-slate-900">{result.marketplaceName}</h2>
      {isLowest && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">Menor preço</span>}
    </div>
    <p className="mt-5 text-sm text-slate-500">Preço recomendado</p>
    <p className="mt-1 text-3xl font-bold tracking-tight text-slate-950">{formatCurrency(result.recommendedPrice)}</p>
    <p className="mt-2 text-xs text-slate-500">Mínimo calculado: {formatCurrency(result.minimumPrice)}</p>

    <details className="mt-5 border-t border-slate-200 pt-4">
      <summary className="min-h-11 cursor-pointer rounded-md py-3 text-sm font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">{metric} publicitário por objetivo</summary>
      <div className="mt-3 space-y-3">
      <p className="text-xs text-slate-600">Receita atribuída ÷ gasto em anúncios, no preço recomendado acima.</p>
      {scenarios ? scenarios.map((scenario) => <div key={scenario.label} className="rounded-md border border-slate-200 p-3">
        <p className="text-sm font-medium text-slate-800">{scenario.label}</p>
        <p className="mt-1 text-xl font-semibold text-slate-900">{metric} {percentageFormatter.format(scenario.returnMultiple)}x</p>
        <p className="mt-1 text-xs text-slate-600">Anúncios por venda: até {formatCurrency(Math.floor(scenario.adCost * 100) / 100)}</p>
        <p className="mt-1 text-xs text-slate-600">Lucro após anúncios: {formatCurrency(scenario.profitAfterAds)} · margem {percentageFormatter.format(scenario.netMargin)}%</p>
      </div>) : <p role="status" className="text-sm text-slate-600">Sem sobra para anúncios. Aumente o preço ou revise os custos para calcular um retorno de equilíbrio.</p>}
      <p className="text-xs text-slate-600">{result.marketplaceId === "shopee"
        ? "Shopee: vendas atribuídas até 7 dias após o clique ou 1 dia após a visualização do anúncio."
        : result.marketplaceId === "tiktokShop"
          ? "TikTok: receita total dos pedidos atribuídos ao plano ÷ despesa publicitária. No GMV Max, pode incluir pedidos pagos e orgânicos."
          : isOwnDomain
            ? "Domínio Próprio: receita atribuída aos anúncios ÷ investimento em publicidade. Ex.: ROAS 2x = R$ 2 em receita por R$ 1 em anúncios."
            : "Mercado Livre: receita atribuída por real investido. Ex.: ROAS 2x = R$ 2 em receita por R$ 1 em anúncios."}</p>
      </div>
    </details>
    <div className="mt-5 border-t border-slate-200 pt-3">
      <DetailRow label="Custo material" value={formatCurrency(result.materialCost)} />
      <DetailRow label="Gastos extras" value={formatCurrency(result.extraCosts)} />
      {!isOwnDomain && <>
      <DetailRow label="Custo do produto" value={formatCurrency(result.totalCost)} />
      <DetailRow label="Marketplace" value={formatCurrency(result.marketplaceCost)} />
      <DetailRow label="Taxa percentual" value={`${percentageFormatter.format(result.percentageFee)}%`} />
      <DetailRow label="Taxa fixa" value={formatCurrency(result.fixedFee)} />
      </>}
      <DetailRow label="Impostos" value={formatCurrency(result.taxes)} />
      <DetailRow label="Trabalho" value={formatCurrency(result.labor)} />
      <DetailRow label="Lucro antes de anúncios" value={formatCurrency(result.estimatedProfit)} />
    </div>
    <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
      <span className="font-medium text-slate-600">Margem antes de anúncios</span>
      <span className="font-semibold text-slate-900">{percentageFormatter.format(result.netMargin)}%</span>
    </div>
    <KitSimulation input={input} channelId={result.marketplaceId} options={kitOptions} />
  </article>;
}

export function PricingCalculator() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [kitForms, setKitForms] = useState<Record<SalesChannelId, KitFormState>>({
    shopee: { ...INITIAL_KIT_FORM }, mercadoLivre: { ...INITIAL_KIT_FORM },
    tiktokShop: { ...INITIAL_KIT_FORM }, dominioProprio: { ...INITIAL_KIT_FORM },
  });

  const calculation = useMemo(() => {
    const values = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, parseDecimal(value)])) as Record<keyof FormState, number>;
    const hasInvalidValue = Object.values(values).some((value) => !Number.isFinite(value) || value < 0);
    const totalPercentage = values.taxesPercentage + values.laborPercentage + values.profitPercentage;
    if (hasInvalidValue || values.pricePerMeter <= 0 || values.metersUsed <= 0 || totalPercentage >= 80) return null;

    try {
      return PricingCalculatorUtils.calculateMarketplacePrices(values, true);
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
    { key: "metersUsed", label: "Metragem por peça", suffix: "m" },
    { key: "extraCosts", label: "Gastos extras por venda/kit", suffix: "R$" },
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
        <p className="mt-5 text-xs text-slate-600">Custos adicionais para a simulação dos kits. Frete em reais por kit; demais campos em percentual. Zero desconsidera o custo. Os valores são independentes por canal.</p>
        <div className="mt-4 space-y-4">
          {KIT_CHANNELS.map(channel => <fieldset key={channel.id} className="min-w-0 rounded-md border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-900">{channel.name}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {KIT_FIELDS.filter(field => !field.tiktokOnly || channel.id === "tiktokShop").map(field => <label key={field.key} className="block text-sm font-medium text-slate-700">
                {field.label}
                <input className="input mt-1 min-h-11" inputMode="decimal" value={kitForms[channel.id][field.key]} onChange={event => {
                  const value = event.target.value;
                  setKitForms(current => ({ ...current, [channel.id]: { ...current[channel.id], [field.key]: value } }));
                }} />
              </label>)}
            </div>
          </fieldset>)}
        </div>
      </details>
    </section>

    {!calculation && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Preencha valores positivos. A soma de imposto, trabalho e lucro deve permitir o cálculo do preço.</div>}

    {calculation && <>
      <p className="text-sm text-slate-600">ROAS (Shopee, Mercado Livre e Domínio Próprio) e ROI (TikTok) são múltiplos de receita por real gasto em publicidade. Mínimo = preço ÷ sobra após material, extras, taxas, impostos e trabalho. Intermediário e bom são simulações que preservam 25% e 50% dessa sobra como lucro após anúncios. Inclua todos os custos por venda; a simulação não consulta campanhas e considera a receita atribuída igual ao preço recomendado.</p>
      <div className="grid gap-5 xl:grid-cols-2">
        {calculation.map((result) => <ResultCard key={result.marketplaceId} result={result} kitOptions={kitForms[result.marketplaceId]} input={Object.fromEntries(Object.entries(form).map(([key, value]) => [key, parseDecimal(value)])) as PricingInput} isLowest={result.recommendedPrice === lowestPrice} />)}
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-900">Comparação final</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-3">Canal de venda</th><th className="px-5 py-3">Preço recomendado</th><th className="px-5 py-3">Taxas de marketplace</th><th className="px-5 py-3">Lucro antes de anúncios</th></tr>
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
