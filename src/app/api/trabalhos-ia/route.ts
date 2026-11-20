import { z } from "zod";
import { trabalhosIa } from "@/lib/trabalhos-ia/runtime";
import { erroIa,jsonIa,sessaoIa } from "@/lib/trabalhos-ia/http";

export async function GET(request: Request) {
  try {
    const escopo=await sessaoIa(request);
    const busca=new URL(request.url).searchParams;
    const tipo=z.string().min(1).max(100).parse(busca.get("tipo"));
    const origens=z.array(z.uuid()).max(50).parse(busca.getAll("origem"));
    return jsonIa({trabalhos:await trabalhosIa.listar(escopo,tipo,origens)});
  } catch(error) { return erroIa(error); }
}
