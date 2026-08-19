import { AccessGuard } from "@/components/access-guard";
import { PageHeader } from "@/components/page-header";
import { PricingCalculator } from "@/components/pricing-calculator/PricingCalculator";

export default function PricingCalculatorPage() {
  return <AccessGuard permissions={["podeVisualizarEstoque", "podeEditarEstoque"]}>
    <PageHeader
      title="Calculadora de Precificação"
      description="Compare rapidamente o preço de venda para cada marketplace. Os dados ficam somente nesta tela."
    />
    <PricingCalculator />
  </AccessGuard>;
}
