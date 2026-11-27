import { z } from "zod";
import { catalogoComercial } from "./catalogo";

const idsEventos = new Set(catalogoComercial.map((evento) => evento.id));
export const eventoSchema = z.string().refine((id) => idsEventos.has(id), "Evento inválido.");
export const buscaProdutosSchema = z.object({
  eventoId: eventoSchema,
  busca: z.string().trim().max(120).default(""),
  associados: z.boolean().default(false),
  pagina: z.number().int().min(0).max(10000).default(0),
});
export const alteracoesProdutosSchema = z.object({
  eventoId: eventoSchema,
  adicionar: z.array(z.uuid()).max(100),
  remover: z.array(z.uuid()).max(100),
}).refine((dados) => {
  const adicionar = new Set(dados.adicionar);
  return dados.adicionar.length + dados.remover.length <= 100
    && adicionar.size === dados.adicionar.length
    && new Set(dados.remover).size === dados.remover.length
    && !dados.remover.some((id) => adicionar.has(id));
}, "Seleção inválida.");
export type AlteracoesProdutos = z.infer<typeof alteracoesProdutosSchema>;
export type ProdutoEvento = { id: string; sku: string; titulo: string; ativo: boolean; associado: boolean };
export const TAMANHO_PAGINA = 20;

export type UsuarioProdutosCalendario = {
  ativo: boolean; aplicativoId: string | null; podeVisualizarTarefasMidia: boolean;
};
export function autorizarProdutosCalendario(usuario: UsuarioProdutosCalendario | null): string {
  if (!usuario?.ativo || !usuario.aplicativoId || !usuario.podeVisualizarTarefasMidia) {
    throw new Error("Sem permissão para associar produtos ao calendário.");
  }
  return usuario.aplicativoId;
}

export class ProdutoCalendarioIndisponivel extends Error {}

// Aplica somente mudanças explícitas, preservando vínculos criados em outra sessão.
export async function aplicarAlteracoesProdutos(dados: AlteracoesProdutos, deps: {
  bloquearProdutosAtivos: (ids: string[]) => Promise<string[]>;
  adicionar: (ids: string[]) => Promise<void>;
  remover: (ids: string[]) => Promise<void>;
}) {
  const adicionar = [...dados.adicionar].sort();
  if (adicionar.length) {
    const ativos = await deps.bloquearProdutosAtivos(adicionar);
    if (ativos.length !== adicionar.length) {
      throw new ProdutoCalendarioIndisponivel("Um produto foi desativado ou não está disponível neste aplicativo. Revise a seleção.");
    }
    await deps.adicionar(adicionar);
  }
  if (dados.remover.length) await deps.remover(dados.remover);
}
