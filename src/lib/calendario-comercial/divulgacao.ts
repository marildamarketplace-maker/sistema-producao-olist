import { z } from "zod";
import { catalogoComercial } from "./catalogo";
import { montarPlanejamento, REGIOES } from "./planejamento";
import type { PotencialCompra } from "./potencial-compra";

export type OrdemDivulgacao = "estoque_desc" | "estoque_asc" | "prioridade";
export const PAGINA_DIVULGACAO = 20;
export const filtrosDivulgacaoSchema = z.object({
  mes: z.number().int().min(1).max(12),
  regiao: z.enum(REGIOES).default("Nacional"),
  ordem: z.enum(["estoque_desc", "estoque_asc", "prioridade"]).optional(),
  pagina: z.number().int().min(0).max(10000).default(0),
}).strict();
export type FiltrosDivulgacao = z.infer<typeof filtrosDivulgacaoSchema>;
export type EventoDivulgacao = {
  id: string; nome: string; potencial: PotencialCompra["nivel"]; peso: number;
};
const pesos: Record<PotencialCompra["nivel"], number> = { "Muito alto": 2, Alto: 1.6, Moderado: 1.3, Baixo: 1 };
export function eventosParaDivulgar({ mes, regiao }: FiltrosDivulgacao): EventoDivulgacao[] {
  return montarPlanejamento(catalogoComercial, {
    mes, regioes: regiao === "Nacional" ? ["Nacional"] : ["Nacional", regiao],
    visao: "mensal", etapa: "divulgar",
  })[mes - 1].divulgar.map(({ evento }) => ({
    id: evento.id, nome: evento.nome, potencial: evento.potencialCompra.nivel, peso: pesos[evento.potencialCompra.nivel],
  }));
}
export type PerfilDivulgacao = "estoque" | "saidas" | "sem_estoque";
export type ProdutoDivulgacao = {
  id: string; titulo: string; sku: string; estoque: number; saidas: number;
  perfil: PerfilDivulgacao; eventoPrincipal: string; eventos: string[];
};
export type PaginaDivulgacao = {
  produtos: ProdutoDivulgacao[]; temMais: boolean; referenciaEm: string; inicioEm: string;
};
export type UsuarioDivulgacao = {
  ativo: boolean; aplicativoId: string | null; podeVisualizarTarefasMidia: boolean;
  podeVisualizarEstoque: boolean; podeEditarEstoque: boolean;
};
export type ResultadoDivulgacao = { ok: true; dados: PaginaDivulgacao; eventos: EventoDivulgacao[] }
  | { ok: false; erro: string };

// A autenticação e a consulta são fronteiras pequenas, injetáveis para testar autorização.
export async function consultarDivulgacao(token: string, entrada: unknown, deps: {
  autenticar: (token: string) => Promise<UsuarioDivulgacao | null>;
  consultar: (aplicativoId: string, eventos: EventoDivulgacao[], pagina: number, ordem: OrdemDivulgacao) => Promise<PaginaDivulgacao>;
}): Promise<ResultadoDivulgacao> {
  const filtros = filtrosDivulgacaoSchema.safeParse(entrada);
  if (!filtros.success) return { ok: false, erro: "Mês, abrangência ou página inválidos." };
  if (typeof token !== "string" || !token || token.length > 16384) return { ok: false, erro: "Sessão inválida. Entre novamente." };
  try {
    const usuario = await deps.autenticar(token);
    if (!usuario?.ativo || !usuario.aplicativoId || !usuario.podeVisualizarTarefasMidia
      || (!usuario.podeVisualizarEstoque && !usuario.podeEditarEstoque)) {
      return { ok: false, erro: "É necessário acesso ao calendário e ao estoque para consultar os produtos." };
    }
    const eventos = eventosParaDivulgar(filtros.data);
    const dados = await deps.consultar(usuario.aplicativoId, eventos, filtros.data.pagina, filtros.data.ordem ?? "estoque_desc");
    return { ok: true, dados, eventos };
  } catch {
    return { ok: false, erro: "Não foi possível carregar os produtos para divulgação. Verifique sua sessão e tente novamente." };
  }
}
