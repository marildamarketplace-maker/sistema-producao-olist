import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";

test("calendário preserva seleção ao renovar token e isola trocas de identidade", {
  skip: chrome ? false : "Chrome/Chromium indisponível", timeout: 60_000,
}, async t => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/calendario-sessao-browser.tsx", [{
    name: "dependencias-calendario", setup(builder) {
      const fixture = path.resolve("tests/fixtures/calendario-sessao-browser.tsx");
      builder.onResolve({ filter: /^(?:@\/components\/auth-provider|\.\/actions)$/ }, () => ({ path: fixture }));
      builder.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: "calendario-teste" }));
      builder.onLoad({ filter: /.*/, namespace: "calendario-teste" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents: args.path === "next/link"
        ? 'export default function Link(props) { return <a {...props} />; }'
        : 'const router={replace(){}};const params=new URLSearchParams("mes=11&etapa=divulgar");export const useRouter=()=>router;export const usePathname=()=>"/controle-midia/calendario";export const useSearchParams=()=>params;' }));
    },
  }]);
  const avaliar = <T,>(codigo: string) => cdp.avaliar<T>(codigo);
  const aberto = 'Boolean(document.querySelector("dialog[open]"))';
  async function abrir() {
    await ate(() => avaliar<boolean>('Boolean([...document.querySelectorAll("button")].find(b=>b.textContent.includes("Associar produtos")&&b.textContent.includes("Natal")))'), "Calendário não carregou");
    await avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Associar produtos")&&b.textContent.includes("Natal")).click()');
    await ate(() => avaliar<boolean>('Boolean(document.querySelector("dialog input[type=checkbox]"))'), "Produtos não carregaram");
    assert.equal(await avaliar('document.querySelector("dialog input[type=checkbox]").checked'), false);
    assert.match(await avaliar<string>('document.querySelector("dialog footer").textContent'), /0 alterações pendentes/);
  }
  async function selecionar() {
    await abrir();
    await avaliar('document.querySelector("dialog input[type=checkbox]").click()');
    await ate(() => avaliar<boolean>('document.querySelector("dialog footer").textContent.includes("1 alterações pendentes")'), "Seleção não foi registrada");
  }
  await cdp.pedir("Page.navigate", { url });
  await selecionar();
  await avaliar('window.calendarioSessaoTeste.mudar("token")');
  await ate(() => avaliar<boolean>('document.body.textContent.includes("token-renovado") && Boolean(document.querySelector("dialog input[type=checkbox]"))'), "Renovação não terminou");
  assert.equal(await avaliar(aberto), true);
  assert.equal(await avaliar('document.querySelector("dialog input[type=checkbox]").checked'), true);
  assert.match(await avaliar<string>('document.querySelector("dialog footer").textContent'), /1 alterações pendentes/);
  await avaliar('[...document.querySelectorAll("dialog button")].find(b=>b.textContent.includes("Salvar associações")).click()');
  await ate(() => avaliar<boolean>('window.calendarioSessaoTeste.gravacoes.length===1'), "Não salvou");
  assert.deepEqual(await avaliar('window.calendarioSessaoTeste.gravacoes'), [{ token: "token-renovado", adicionar: ["10000000-0000-4000-8000-000000000001"] }]);
  for (const tipo of ["usuario", "aplicativo"]) {
    await cdp.pedir("Page.navigate", { url });
    await selecionar();
    await avaliar(`window.calendarioSessaoTeste.mudar('${tipo}')`);
    await ate(async () => !await avaliar<boolean>(aberto), "Troca de identidade manteve o diálogo anterior");
    await abrir();
    assert.deepEqual(await avaliar('window.calendarioSessaoTeste.gravacoes'), []);
    assert.deepEqual(cdp.erros, []);
  }
});
