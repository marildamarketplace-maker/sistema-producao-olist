import { z } from "zod";
import type { OpcaoFilaOlist } from "./fila-olist-contrato";

const normalizar = (nome: string) => nome.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
const respostaPesquisaSchema = z.object({
  itens: z.array(z.object({
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    nome: z.string().trim().min(1),
    referencia: z.string().optional(),
    preco: z.number().min(0).max(1e9).optional(),
  })).max(50),
  mais: z.boolean(),
  pagina: z.number().int().min(1).max(1000).optional(),
});
export type PaginaPesquisaTecidosOlist = {
  itens: OpcaoFilaOlist[]; pagina: number; mais: boolean; exato: OpcaoFilaOlist | null;
};

/** Uma consulta por página: resultados parciais dependem de escolha explícita. */
export async function pesquisarPaginaTecidosOlist(nome: string, pagina: number,
  carregar: (pagina: number) => Promise<unknown>): Promise<PaginaPesquisaTecidosOlist> {
  if (!nome.trim() || nome.trim().length > 120) throw new Error("Informe um nome de tecido com até 120 caracteres para pesquisar.");
  if (!Number.isInteger(pagina) || pagina < 1 || pagina > 1000) throw new Error("Página de pesquisa inválida.");
  const parsed = respostaPesquisaSchema.safeParse(await carregar(pagina));
  if (!parsed.success || parsed.data.pagina !== undefined && parsed.data.pagina !== pagina) {
    throw new Error("A Olist retornou uma pesquisa inválida. Tente novamente.");
  }
  const { itens, mais } = parsed.data;
  // Mesmo um nome exato não escolhe silenciosamente entre opções ou páginas.
  const exato = pagina === 1 && itens.length === 1 && !mais && normalizar(itens[0].nome) === normalizar(nome) ? itens[0] : null;
  return { itens, pagina, mais, exato };
}
