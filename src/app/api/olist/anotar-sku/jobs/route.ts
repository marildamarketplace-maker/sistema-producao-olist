import { NextResponse } from "next/server";
import { autenticarSku, erroRespostaSku, repoSku, resumoJobSku } from "@/lib/anotar-sku/api";
import { criarBuscaSkuSchema, ErroAnotarSku } from "@/lib/anotar-sku/contrato";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const escopo = await autenticarSku(request, "jobs");
    const [{ jobs, emAberto }, disponibilidade] = await Promise.all([repoSku.listar(escopo), repoSku.disponibilidade(escopo.aplicativoId)]);
    return NextResponse.json({ jobs: jobs.map(j => resumoJobSku(j, escopo)), emAberto, ...disponibilidade },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (erro) { return erroRespostaSku(erro); }
}
export async function POST(request: Request) {
  try {
    const escopo = await autenticarSku(request, "write");
    const entrada = criarBuscaSkuSchema.safeParse(await request.json().catch(() => null));
    if (!entrada.success) throw new ErroAnotarSku("Selecione ao menos uma situação válida e envie uma solicitação válida.", 400);
    const job = await repoSku.criar(escopo, entrada.data);
    return NextResponse.json({ job: resumoJobSku(job, escopo) }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (erro) { return erroRespostaSku(erro); }
}
