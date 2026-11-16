import { NextResponse } from "next/server";
import { z } from "zod";
import { autenticarSku, erroRespostaSku, filaSkuHabilitada, repoSku, resumoJobSku } from "@/lib/anotar-sku/api";
import { acaoBuscaSkuSchema, ErroAnotarSku } from "@/lib/anotar-sku/contrato";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const escopo = await autenticarSku(request, "write");
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) throw new ErroAnotarSku("Busca inválida.", 400);
    const entrada = acaoBuscaSkuSchema.safeParse(await request.json().catch(() => null));
    if (!entrada.success) throw new ErroAnotarSku("Operação inválida.", 400);
    if (entrada.data.acao === "retomar" && !filaSkuHabilitada()) throw new ErroAnotarSku("O processamento está temporariamente pausado.", 503);
    return NextResponse.json({ job: resumoJobSku(await repoSku.agir(escopo, id, entrada.data.acao), escopo) });
  } catch (erro) { return erroRespostaSku(erro); }
}
