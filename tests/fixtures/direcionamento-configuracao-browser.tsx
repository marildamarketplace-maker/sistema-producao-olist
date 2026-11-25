import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DirecionamentoPedidosConfiguracao } from "../../src/components/direcionamento-pedidos-configuracao";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const regra = (n: number) => ({ id: id(n), nome: `Regra ${n}`, ativa: true, aplicativoId: id(3), combinacao: "E", condicoes: [{ campo: "UF_EM", ufs: ["MG"] }] });
const params = new URLSearchParams(location.search);
type Auth = { token: string; usuario: string; app: string };
declare global { interface Window { direcionamentoTeste: {
  salvos: unknown[]; erro: boolean; auth: Auth; leituras: number;
  segurarGet: boolean; segurarPut: boolean; liberarGets: () => void; liberarPuts: () => void;
  mudarAuth: (patch: Partial<Auth>) => void;
} } }
const gets: Array<() => void> = [], puts: Array<() => void> = [];
window.direcionamentoTeste = { salvos: [], erro: false, auth: { token: "fake", usuario: "usuario1", app: "pai" }, leituras: 0,
  segurarGet: params.has("segurarGet"), segurarPut: false,
  liberarGets: () => gets.splice(0).forEach(resolve => resolve()), liberarPuts: () => puts.splice(0).forEach(resolve => resolve()),
  mudarAuth: patch => { Object.assign(window.direcionamentoTeste.auth, patch); window.dispatchEvent(new Event("auth-test")); },
};
window.fetch = async (_input, init) => {
  const estado = window.direcionamentoTeste;
  if (init?.method === "PUT") {
    const configuracao = JSON.parse(String(init.body));
    if (estado.segurarPut) await new Promise<void>(resolve => puts.push(resolve));
    if (estado.erro) return Response.json({ error: "Configuração alterada por outro usuário. Recarregue antes de salvar." }, { status: 409 });
    estado.salvos.push(configuracao);
    return Response.json({ configuracao: { ...configuracao, versao: configuracao.versao + 1 } });
  }
  estado.leituras++;
  const regras = [regra(1), regra(2)].map(r => ({ ...r, nome: estado.auth.app === "pai" && estado.auth.usuario === "usuario1" ? r.nome : `${estado.auth.app}/${estado.auth.usuario}` }));
  const resposta = { disponivel: true, filhos: [{ id: id(3), nome: "Aplicativo com nome longo para validar o formulário de direcionamento" }], configuracao: { versao: 1, aplicativoPadraoId: id(3), regras } };
  // Ignora AbortSignal de propósito: prova que respostas obsoletas não alteram estado.
  if (estado.segurarGet) await new Promise<void>(resolve => gets.push(resolve));
  return Response.json(resposta);
};
document.documentElement.classList.toggle("dark", params.get("tema") === "dark");
function App() {
  const [disponivel, setDisponivel] = useState(false);
  return <main className="mx-auto max-w-6xl p-4"><DirecionamentoPedidosConfiguracao ativo onDisponivel={setDisponivel} /><p hidden={!disponivel}>Configuração do pai</p></main>;
}
createRoot(document.getElementById("root")!).render(<App />);
