import { trabalhosIa } from "@/lib/trabalhos-ia/runtime";
import { configurarIaSchema,TIPO_RELATORIO_SKU } from "@/lib/trabalhos-ia/contrato";
import { corpoIa,erroIa,jsonIa,sessaoIa } from "@/lib/trabalhos-ia/http";
export async function GET(request:Request) {
  try { return jsonIa(await trabalhosIa.configuracao(await sessaoIa(request),TIPO_RELATORIO_SKU)); }
  catch(error) { return erroIa(error); }
}
export async function PUT(request:Request) {
  try {
    const escopo=await sessaoIa(request),entrada=configurarIaSchema.parse(await corpoIa(request));
    return jsonIa(await trabalhosIa.configurar(escopo,TIPO_RELATORIO_SKU,entrada.prompt,entrada.revisao,entrada.gerarAutomaticamente));
  } catch(error) { return erroIa(error); }
}
