import type { Metadata } from "next";
import { ConfirmacaoEntregaProducaoPublica } from "@/components/confirmacao-entrega-producao-publica";

export const metadata: Metadata = {
  title: "Confirmar entrega de produção",
  description: "Confirme rapidamente as quantidades entregues da produção.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function ConfirmarEntregaProducaoPage() {
  return <ConfirmacaoEntregaProducaoPublica />;
}
