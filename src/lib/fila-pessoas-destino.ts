import { listarVendedoresOlistApi, obterCadastroFornecedorOlist } from "./olist";
export type PessoaDestinoFila = { id: number; nome: string; documento: string | null; email: string | null; telefone: string | null };
function texto(v: unknown) { return typeof v === "string" && v.trim() ? v.trim().slice(0,250) : null; }
function pessoa(dados: Record<string, unknown>, id: number): PessoaDestinoFila {
 const contato=dados.contato && typeof dados.contato === "object" && !Array.isArray(dados.contato) ? dados.contato as Record<string,unknown> : dados;
 return {id,nome:texto(dados.nome)??texto(contato.nome)??"Nome não informado",documento:texto(contato.cpfCnpj),email:texto(contato.email),telefone:texto(contato.telefone)??texto(contato.celular)};
}
export async function consultarPessoasDestinoFila(app: string, clienteId: number, vendedorId: number,
 deps={obter:obterCadastroFornecedorOlist,listar:listarVendedoresOlistApi}) {
 const cliente=await deps.obter(app,"contatos",clienteId);
 let vendedor: Record<string,unknown>|undefined;
 for(let pagina=0;pagina<4;pagina++) {
  const lista=await deps.listar(app,{limit:100,offset:pagina*100});
  vendedor=lista.itens.find(i=>Number(i.id)===vendedorId);
  if(vendedor||lista.itens.length<100)break;
 }
 if(vendedor && vendedor.contato && typeof vendedor.contato === "object" && "id" in vendedor.contato) {
  const contatoId=Number(vendedor.contato.id);
  if(Number.isSafeInteger(contatoId)&&contatoId>0) vendedor={...vendedor,contato:await deps.obter(app,"contatos",contatoId)};
 }
 return {cliente:pessoa(cliente,clienteId),vendedor:vendedor?pessoa(vendedor,vendedorId):null};
}
