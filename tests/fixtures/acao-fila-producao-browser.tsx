import { createRoot } from "react-dom/client";
import { AcaoFilaProducao } from "../../src/components/acao-fila-producao";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("tema") === "dark");
const base = { solicitacaoId: "origem", aoVerDetalhes: () => {}, autenticado: true, filaDisponivel: true, podeSolicitar: true };
createRoot(document.getElementById("root")!).render(<main className="space-y-4 p-4">
  <section data-testid="sem-fornecedor"><AcaoFilaProducao {...base} disponibilidade={{ temFornecedor: false, podeEnviar: false, motivoBloqueio: null }} /></section>
  <section data-testid="sem-vendedor"><AcaoFilaProducao {...base} disponibilidade={{ temFornecedor: true, podeEnviar: false, motivoBloqueio: "Vendedor não vinculado ao fornecedor." }} /></section>
  <section data-testid="habilitada"><AcaoFilaProducao {...base} disponibilidade={{ temFornecedor: true, podeEnviar: true, motivoBloqueio: null }} /></section>
  <section data-testid="existente"><AcaoFilaProducao {...base} status="PENDENTE" disponibilidade={{ temFornecedor: false, podeEnviar: false, motivoBloqueio: null }} /></section>
</main>);
