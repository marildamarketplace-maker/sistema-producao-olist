import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

test("modais sobrepostos fecham somente o superior e restauram foco e rolagem", () => {
  const listeners = new Set<(event: { key: string; preventDefault: () => void }) => void>();
  const effects: Array<() => void> = [];
  const cleanups: Array<() => void> = [];
  class Elemento {
    isConnected = true;
    focus() { document.activeElement = this; }
    querySelectorAll() { return []; }
  }
  const document = {
    activeElement: new Elemento(), body: { style: { overflow: "auto" } },
    addEventListener: (_: string, listener: (event: { key: string; preventDefault: () => void }) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: { key: string; preventDefault: () => void }) => void) => listeners.delete(listener),
  };
  const exports: { useModalFocus?: (onClose: () => void) => { current: Elemento | null } } = {};
  const source = readFileSync(new URL("../src/hooks/use-modal-focus.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, document, HTMLElement: Elemento,
    require: () => ({ useRef: (current: unknown) => ({ current }), useEffect: (effect: () => void) => effects.push(effect) }),
  });
  function abrir(onClose: () => void) {
    const ref = exports.useModalFocus!(onClose);
    ref.current = new Elemento();
    for (const effect of effects.splice(0)) {
      const cleanup = effect();
      if (typeof cleanup === "function") cleanups.push(cleanup);
    }
    return ref.current;
  }
  const disparador = document.activeElement;
  let detalhesFechados = 0;
  let imagensFechadas = 0;
  const detalhes = abrir(() => detalhesFechados++);
  abrir(() => imagensFechadas++);
  const escape = () => { for (const listener of listeners) listener({ key: "Escape", preventDefault() {} }); };
  escape();
  assert.equal(imagensFechadas, 1);
  assert.equal(detalhesFechados, 0);
  cleanups.pop()!();
  assert.equal(document.activeElement, detalhes);
  assert.equal(document.body.style.overflow, "hidden");
  escape();
  assert.equal(detalhesFechados, 1);
  cleanups.pop()!();
  assert.equal(document.activeElement, disparador);
  assert.equal(document.body.style.overflow, "auto");
  assert.equal(listeners.size, 0);
});
