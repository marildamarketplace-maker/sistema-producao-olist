import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ImagemItemProducao } from "../../src/components/imagem-item-producao";
import { EditarDadosProducao } from "../../src/components/editar-dados-producao";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("tema") === "dark");
const imagem = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="green"/></svg>'], { type: "image/svg+xml" }));
const chamadas: Record<string, number> = {};
Object.assign(window, { chamadas, corpos: {} });
window.fetch = async (input, options) => {
  const url = String(input); chamadas[url] = (chamadas[url] ?? 0) + 1;
  Object.assign(window, { corpos: { ...(window as unknown as { corpos: object }).corpos, [url]: options?.body } });
  if (url === "/dados") {
    const dados = JSON.parse(String(options?.body));
    if (chamadas[url] === 1) return Response.json({ error: "Falha recuperável" }, { status: 409 });
    return Response.json(dados);
  }
  if (url === "/falha" && chamadas[url] === 1) return Response.json({ error: "Falha simulada" }, { status: 500 });
  return Response.json({ imagemUrl: "https://example.test/imagem.svg" });
};
// Entrega a imagem local no navegador sem acessar serviços externos.
const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
Object.defineProperty(HTMLImageElement.prototype, "src", { ...descriptor, set(value: string) { descriptor.set!.call(this, value === "https://example.test/imagem.svg" ? imagem : value === "https://example.test/quebrada.svg" ? "data:image/png,invalida" : value); } });
// React atribui src por atributo.
const setAttribute = HTMLImageElement.prototype.setAttribute;
HTMLImageElement.prototype.setAttribute = function(name, value) { return setAttribute.call(this, name, name === "src" && value === "https://example.test/imagem.svg" ? imagem : value === "https://example.test/quebrada.svg" ? "data:image/png,invalida" : value); };
function App() {
  const [dados, setDados] = useState({ dataEntrega: "2026-11-25", prioridadeProducao: false });
  return <main className="space-y-4 p-4">
    <div data-testid="auto"><ImagemItemProducao sku="AUTO" imagemUrl={null} endpoint="/auto" token="teste" /></div>
    <div data-testid="erro"><ImagemItemProducao sku="ERRO" imagemUrl={null} endpoint="/falha" token="teste" /></div>
    <div className="hidden sm:block"><ImagemItemProducao sku="DUPLICADA" imagemUrl={null} endpoint="/auto" token="teste" /></div>
    <div data-testid="quebrada"><ImagemItemProducao sku="QUEBRADA" imagemUrl="https://example.test/quebrada.svg" endpoint="/quebrada" token="teste" /></div>
    <EditarDadosProducao id="dados" token="teste" dados={dados} onSalvo={setDados} />
    <output>{dados.dataEntrega} {String(dados.prioridadeProducao)}</output>
  </main>;
}
// Mantém o endpoint real do editor e contabiliza com uma chave curta.
const mock = window.fetch;
window.fetch = (input, options) => mock(String(input).startsWith("/api/solicitacoes-producao/") ? "/dados" : input, options);
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
