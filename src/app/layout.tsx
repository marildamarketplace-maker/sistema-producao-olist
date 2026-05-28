import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

export const metadata: Metadata = {
  title: "Sistema de Produção e Estoque",
  description: "Controle de produção têxtil com integração futura à Olist",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
