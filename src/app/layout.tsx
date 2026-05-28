import type { Metadata } from "next";
import { Suspense } from "react";
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
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6 text-sm text-slate-600">
              Carregando...
            </div>
          }
        >
          <AuthProvider>
            <AppShell>{children}</AppShell>
          </AuthProvider>
        </Suspense>
      </body>
    </html>
  );
}
