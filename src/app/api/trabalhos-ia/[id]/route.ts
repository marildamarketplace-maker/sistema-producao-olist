import { z } from "zod";
import { trabalhosIa } from "@/lib/trabalhos-ia/runtime";
import { acaoIaSchema } from "@/lib/trabalhos-ia/contrato";
import { corpoIa,erroIa,jsonIa,sessaoIa } from "@/lib/trabalhos-ia/http";
type Contexto={params:Promise<{id:string}>};
export async function GET(request: Request,c:Contexto) {
  try { return jsonIa({trabalho:await trabalhosIa.obter(await sessaoIa(request),z.uuid().parse((await c.params).id))}); }
  catch(error) { return erroIa(error); }
}
export async function PATCH(request:Request,c:Contexto) {
  try {
    const escopo=await sessaoIa(request),id=z.uuid().parse((await c.params).id);
    const {acao}=acaoIaSchema.parse(await corpoIa(request));
    return jsonIa(await trabalhosIa.agir(escopo,id,acao));
  } catch(error) { return erroIa(error); }
}
