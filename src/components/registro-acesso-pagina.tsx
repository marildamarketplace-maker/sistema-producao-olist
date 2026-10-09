"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "./auth-provider";
import { paginasPermitidas } from "@/lib/navigation";

export function RegistroAcessoPagina() {
  const pathname = usePathname();
  const { usuario, session, loading } = useAuth();
  const ultimo = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    if (!usuario || !session) { ultimo.current = null; return; }
    const chave = `${usuario.id}:${pathname}`;
    if (ultimo.current === chave) return;
    ultimo.current = chave;
    if (!paginasPermitidas(usuario).some((pagina) => pagina.href === pathname)) return;
    // Telemetria não deve interromper a navegação; não repetir POST em falha incerta.
    void fetch("/api/acessos-paginas", {
      method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ pagina: pathname }), keepalive: true,
    }).catch(() => {});
  }, [pathname, usuario, session, loading]);
  return null;
}
