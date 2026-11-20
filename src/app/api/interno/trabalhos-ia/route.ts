import { trabalhosIa } from "@/lib/trabalhos-ia/runtime";
import { autenticarWorkerIa } from "@/lib/trabalhos-ia/credenciais";
import { operacaoIaSchema } from "@/lib/trabalhos-ia/contrato";
import { corpoIa,erroIa,jsonIa } from "@/lib/trabalhos-ia/http";

export const maxDuration=60;
export async function POST(request: Request) {
  try {
    const worker=autenticarWorkerIa(request);
    const operacao=operacaoIaSchema.parse(await corpoIa(request,256*1024));
    return jsonIa(await trabalhosIa.operar(worker,operacao));
  } catch(error) { return erroIa(error); }
}
