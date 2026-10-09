"use client";

import { useEffect, useRef } from "react";

/** Mantém a navegação por teclado dentro do diálogo enquanto ele estiver aberto. */
export function useModalFocus(onClose: () => void) {
  const modal = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);

  useEffect(() => {
    const root = modal.current;
    if (!root) return;
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focaveis = () => Array.from(root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
    )).filter((elemento) => elemento.getClientRects().length > 0);
    (focaveis()[0] ?? root).focus();

    function manterFoco(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elementos = focaveis();
      const primeiro = elementos[0];
      const ultimo = elementos.at(-1);
      if (!primeiro) {
        event.preventDefault();
        root?.focus();
      } else if (!root?.contains(document.activeElement) || document.activeElement === root) {
        event.preventDefault();
        (event.shiftKey ? ultimo : primeiro)?.focus();
      } else if (event.shiftKey && document.activeElement === primeiro) {
        event.preventDefault();
        ultimo?.focus();
      } else if (!event.shiftKey && document.activeElement === ultimo) {
        event.preventDefault();
        primeiro.focus();
      }
    }
    document.addEventListener("keydown", manterFoco);
    return () => {
      document.removeEventListener("keydown", manterFoco);
      document.body.style.overflow = overflow;
      if (anterior?.isConnected) anterior.focus();
    };
  }, []);
  return modal;
}
