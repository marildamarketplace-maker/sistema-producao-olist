import type { KeyboardEvent } from "react";

export function conterFocoNoDialogo(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const campos = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button,input,select,textarea,a[href],[tabindex='0']"))
    .filter((campo) => !campo.matches(":disabled") && campo.getClientRects().length > 0);
  const primeiro = campos[0], ultimo = campos[campos.length - 1];
  if (!primeiro) { event.preventDefault(); event.currentTarget.focus(); return; }
  if (event.shiftKey && document.activeElement === primeiro) { event.preventDefault(); ultimo.focus(); }
  else if (!event.shiftKey && document.activeElement === ultimo) { event.preventDefault(); primeiro.focus(); }
}
