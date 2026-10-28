import { z } from "zod";

const listaKitsSchema = z.object({ componentes: z.array(z.object({
  kitSku: z.string(), sku: z.string(), quantidade: z.number().int().positive(),
})) });

/** Não tenta interpretar respostas vazias/HTML como JSON e valida o contrato da listagem. */
export async function lerRespostaKits(response: Response, metodo = "GET") {
  const texto = await response.text();
  let dados: unknown;
  try { dados = JSON.parse(texto); }
  catch {
    throw new Error(`O servidor retornou uma resposta vazia ou inválida (HTTP ${response.status}). Tente novamente. Se persistir, verifique os logs do servidor.`);
  }
  if (!response.ok) {
    const erro = z.object({ error: z.string().min(1) }).safeParse(dados);
    throw new Error(erro.success ? erro.data.error : `Não foi possível consultar as associações (HTTP ${response.status}).`);
  }
  if (metodo === "GET") {
    const lista = listaKitsSchema.safeParse(dados);
    if (!lista.success) throw new Error("O servidor retornou uma listagem de kits inválida. Tente novamente.");
    return lista.data;
  }
  const sucesso = metodo === "POST"
    ? z.object({ kits: z.number().int().positive(), componentes: z.number().int().positive() }).safeParse(dados)
    : z.object({ ok: z.literal(true) }).safeParse(dados);
  if (!sucesso.success) throw new Error("O servidor não confirmou o salvamento. Confira as associações antes de tentar novamente.");
  return { componentes: [] };
}
