import { createRoot } from "react-dom/client";
import { PricingCalculator } from "../../src/components/pricing-calculator/PricingCalculator";
document.documentElement.classList.toggle("dark", new URLSearchParams(location.search).get("tema") === "dark");
createRoot(document.getElementById("root")!).render(<main className="mx-auto max-w-6xl p-4"><PricingCalculator /></main>);
