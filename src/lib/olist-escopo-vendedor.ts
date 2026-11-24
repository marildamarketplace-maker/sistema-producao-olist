import { prisma } from "@/lib/prisma";
import { ErroAutorizacaoOlist } from "@/lib/olist-autorizacao";
import { obterVendedorDoUsuario } from "@/lib/usuario-vendedor-olist";

/** Um vínculo em qualquer empresa do grupo caracteriza o usuário vendedor. */
export async function resolverVendedorConsultaOlist(usuario: { id: string; aplicativoId: string }, empresaId: string) {
  const vendedorId = await obterVendedorDoUsuario(usuario.id, empresaId);
  if (vendedorId !== null) return vendedorId;
  const vendedorNoGrupo = await prisma.usuarioVendedorOlist.findFirst({
    where: {
      usuarioId: usuario.id,
      OR: [{ aplicativoId: usuario.aplicativoId }, { aplicativo: { aplicativoPaiId: usuario.aplicativoId } }],
    },
    select: { vendedorOlistId: true },
  });
  if (vendedorNoGrupo) throw new ErroAutorizacaoOlist("Usuário vendedor sem vínculo nesta empresa.", 403);
  return null;
}

export function validarVendedorPedidoOlist(pedido: Record<string, unknown>, vendedorId: number | null) {
  if (vendedorId === null) return;
  const vendedor = pedido.vendedor;
  const id = vendedor && typeof vendedor === "object" && !Array.isArray(vendedor)
    ? (vendedor as Record<string, unknown>).id : undefined;
  if ((typeof id !== "number" && typeof id !== "string") || String(id) !== String(vendedorId)) {
    throw new ErroAutorizacaoOlist("Pedido não pertence ao vendedor vinculado nesta empresa.", 403);
  }
}
