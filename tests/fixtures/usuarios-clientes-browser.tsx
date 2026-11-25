import { createRoot } from "react-dom/client";
import { UsuariosClientes } from "../../src/components/usuarios-clientes";

const app = "00000000-0000-0000-0000-000000000001", filho = "00000000-0000-0000-0000-000000000002";
const alvo = "00000000-0000-0000-0000-000000000003";
const usuario = { id: alvo, nome: "Usuário de aplicativo cliente com nome extenso para testar a configuração", aplicativo: { id: "cliente", nome: "Meuryshop com nome extenso" },
  vinculosOlistVersao: 7, vendedoresOlist: [{ aplicativoId: app, vendedorOlistId: 111, confirmado: true }, { aplicativoId: filho, vendedorOlistId: 222, confirmado: false }] };
const estado = { consultas: [] as string[], payloads: [] as Array<{vendedoresOlist:Array<{aplicativoId:string;vendedorOlistId:number}>}>, conflito: true };
Object.assign(window, { usuariosClientesTeste: estado });
document.documentElement.classList.toggle("dark", new URLSearchParams(location.search).get("tema") === "dark");
window.fetch = async (input, init) => {
  const url = new URL(String(input), "https://example.test"); estado.consultas.push(String(input));
  if (init?.method === "PATCH") {
    const payload = JSON.parse(String(init.body)); estado.payloads.push(payload);
    if (estado.conflito) return Response.json({ error: "Vínculos alterados. Recarregue antes de salvar." }, { status: 409 });
    usuario.vinculosOlistVersao++;
    usuario.vendedoresOlist = usuario.vendedoresOlist.map(v => {
      const selecionado=payload.vendedoresOlist.find((p: {aplicativoId:string}) => p.aplicativoId === v.aplicativoId);
      return {...v, vendedorOlistId: selecionado?.vendedorOlistId ?? v.vendedorOlistId, confirmado: Boolean(selecionado)};
    });
  } else if (!url.searchParams.has("usuarioId")) return Response.json({ usuarios: [{id: usuario.id, nome: usuario.nome, aplicativo: usuario.aplicativo}], paginacao: {pagina:1,total:1,totalPaginas:1} });
  return Response.json({usuario, aplicativos:[{id:app,nome:"Matriz fornecedora"},{id:filho,nome:"Filial fornecedora com nome longo"}]});
};
createRoot(document.getElementById("root")!).render(<UsuariosClientes token="teste-local" />);
