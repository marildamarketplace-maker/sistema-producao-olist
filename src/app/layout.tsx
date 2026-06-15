import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import { PwaRegister } from "@/components/pwa-register";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "ERP Shop",
  description: "ERP para controle de produção, estoque, fornecedores e integração Olist",
  applicationName: "ERP Shop",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ERP Shop",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var theme = localStorage.getItem("sistema_producao_theme");
                if (!theme) theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
                document.documentElement.classList.toggle("dark", theme === "dark");
                document.documentElement.style.colorScheme = theme;
              } catch {}
            `,
          }}
        />
      </head>
      <body>
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6 text-sm text-slate-600">
              Carregando...
            </div>
          }
        >
          <ThemeProvider>
            <AuthProvider>
              <PwaRegister />
              <AppShell>{children}</AppShell>
            </AuthProvider>
          </ThemeProvider>
        </Suspense>
      </body>
    </html>
  );
}
