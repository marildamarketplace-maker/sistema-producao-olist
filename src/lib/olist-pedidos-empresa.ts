import { prisma } from "./prisma";
import { ErroAutorizacaoOlist } from "./olist-autorizacao";
import { resolverEmpresaOlist } from "./olist-empresa";
import { resolverVendedorConsultaOlist } from "./olist-escopo-vendedor";
import { resolverRelacaoFornecedor } from "./fornecedor-relacao";
import { obterVinculoVendedorDoUsuario } from "./usuario-vendedor-olist";
import { listarReferenciasPedidoManual } from "./pedido-manual-acesso";

type Usuario = { id: string; aplicativoId: string };
/** Somente pedidos podem consultar uma conta externa, sempre com vendedor confirmado. */
export async function resolverEscopoPedidosOlist(request: Request, usuario: Usuario) {
  let propria: string | undefined;
  try {
    propria = await resolverEmpresaOlist(request, usuario.aplicativoId);
  } catch (erro) {
    if (!(erro instanceof ErroAutorizacaoOlist) || erro.status !== 403) throw erro;
  }
  if (propria) return { aplicativoId: propria, vendedorId: await resolverVendedorConsultaOlist(usuario, propria) };
  const selecionado = new URL(request.url).searchParams.get("aplicativoId");
  if (!selecionado || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selecionado)) {
    throw new ErroAutorizacaoOlist("Empresa não autorizada.", 403);
  }
  const relacao = await resolverRelacaoFornecedor(usuario.aplicativoId, selecionado);
  if (!relacao) throw new ErroAutorizacaoOlist("Empresa não autorizada.", 403);
  const vinculo = await obterVinculoVendedorDoUsuario(usuario.id, selecionado);
  if (!vinculo || vinculo.origemAplicativoId !== usuario.aplicativoId || vinculo.fornecedorMatrizId !== relacao.matrizId) {
    throw new ErroAutorizacaoOlist("Usuário sem vendedor confirmado nesta empresa do fornecedor.", 403);
  }
  return { aplicativoId: selecionado, vendedorId: vinculo.vendedorOlistId };
}

/** Reutiliza a hierarquia limitada de fornecedores; uma consulta resolve os vínculos das opções. */
export async function listarEmpresasFornecedorPedidos(usuario: Usuario) {
  const referencias = (await listarReferenciasPedidoManual(usuario.aplicativoId)).filter(a => a.fornecedorId);
  if (!referencias.length) return [];
  const vinculos = await prisma.usuarioVendedorOlist.findMany({
    where: { usuarioId: usuario.id, origemAplicativoId: usuario.aplicativoId, fornecedorMatrizId: { not: null },
      confirmadoEm: { not: null }, revogadoEm: null, aplicativoId: { in: referencias.map(a => a.id) } },
    select: { aplicativoId: true, fornecedorMatrizId: true, aplicativo: { select: { aplicativoPaiId: true } } }, take: 1001,
  });
  if (vinculos.length > 1000) throw new ErroAutorizacaoOlist("Limite de empresas excedido.", 403);
  const permitidos = new Set(vinculos.filter(v => v.fornecedorMatrizId === (v.aplicativo.aplicativoPaiId ?? v.aplicativoId)).map(v => v.aplicativoId));
  return referencias.filter(a => permitidos.has(a.id)).map(a => ({ id: a.id, nome: a.nome }));
}
