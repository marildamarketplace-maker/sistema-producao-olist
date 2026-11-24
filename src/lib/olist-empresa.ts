import { prisma } from "@/lib/prisma";
import { ErroAutorizacaoOlist } from "@/lib/olist-autorizacao";

/** A conta própria e suas filiais diretas compõem o escopo multiempresa. */
export async function resolverEmpresaOlist(request: Request, aplicativoId: string) {
  const selecionado = new URL(request.url).searchParams.get("aplicativoId");
  if (selecionado === null || selecionado === aplicativoId) return aplicativoId;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selecionado)) {
    throw new ErroAutorizacaoOlist("Empresa não autorizada.", 403);
  }
  const filial = await prisma.aplicativo.findFirst({
    where: { id: selecionado, aplicativoPaiId: aplicativoId }, select: { id: true },
  });
  if (!filial) throw new ErroAutorizacaoOlist("Empresa não autorizada.", 403);
  return filial.id;
}
