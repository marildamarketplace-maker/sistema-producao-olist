import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ErroTrabalhoIa, TIPO_RELATORIO_SKU, textoIa } from "./contrato";
import type { TipoTrabalhoIa } from "./registro";

export const PROMPT_SKU_PADRAO = "Resuma o produto preservando o tipo, a quantidade de peças do kit, medidas e características essenciais presentes no título. Remova repetições. Identifique o tecido somente pelo título: Oxford = Oxford; Sedinha = Fourway; Fourway = Fourway; Tricoline = Tricoline. Se não houver informação suficiente ou houver ambiguidade, use NÃO IDENTIFICADO. Não deduza tecido pela estampa, tema ou tamanho.";
const regras = "Retorne somente o JSON do contrato, com exatamente um item para cada id recebido. Copie os ids sem alterações. Não invente características. Produto deve resumir o título, preservando kits e medidas. Tecido deve seguir as regras do aplicativo. Para tecido identificado, evidencia deve ser um trecho literal do título que sustente a classificação; equivalências podem vir das regras do aplicativo. Quando inconclusivo, tecido deve ser NÃO IDENTIFICADO e evidencia vazia. Título vazio: produto e tecido NÃO IDENTIFICADO. Nunca multiplique quantidades de kits nem gere SKUs ou quantidades.";
export const PROMPT_SKU_GERACAO = `Gere um relatório de produtos e tecidos a partir dos títulos fornecidos. ${regras}`;
export const PROMPT_SKU_REVISAO = `Você é o revisor obrigatório do relatório. Compare cada item candidato com a ENTRADA ORIGINAL e as regras do aplicativo. Confira omissões, duplicações, kits, medidas, informações inventadas e a evidência de tecido. Corrija todos os problemas e retorne o relatório final completo. Não presuma que o candidato está correto. Na dúvida sobre tecido, substitua por NÃO IDENTIFICADO. ${regras}`;
const skuIaSchema = z.string().min(1).max(300).refine(v => !/[\u0000-\u001f]/.test(v));
export const entradaSkuIaSchema = z.array(z.object({ id: skuIaSchema, titulo: textoIa(6_000), quantidade: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict()).max(50);
const saidaItem = z.object({ id: skuIaSchema, produto: textoIa(200).min(1), tecido: textoIa(100).min(1), evidencia: textoIa(1_000) }).strict();
export const saidaSkuIaSchema = z.object({ itens: z.array(saidaItem).min(1).max(50) }).strict();
export type LinhaRelatorioIa = { sku: string; produto: string; tecido: string; quantidade: number };
export function validarRelatorioSkuIa(entrada: unknown, saida: unknown): LinhaRelatorioIa[] {
  const originais = entradaSkuIaSchema.parse(entrada);
  const { itens } = saidaSkuIaSchema.parse(saida);
  const porId = new Map(itens.map(item => [item.id, item]));
  if (porId.size !== itens.length || itens.length !== originais.length || originais.some(item => !porId.has(item.id))) throw new ErroTrabalhoIa("A IA retornou itens diferentes dos solicitados.");
  return originais.map(original => {
    const item = porId.get(original.id)!;
    if (!original.titulo && (item.produto !== "NÃO IDENTIFICADO" || item.tecido !== "NÃO IDENTIFICADO")) throw new ErroTrabalhoIa("A IA inferiu dados sem título.");
    if (item.tecido === "NÃO IDENTIFICADO") {
      if (item.evidencia) throw new ErroTrabalhoIa("Classificação inconclusiva com evidência inconsistente.");
    } else if (!item.evidencia || !original.titulo.toLocaleLowerCase("pt-BR").includes(item.evidencia.toLocaleLowerCase("pt-BR"))) {
      throw new ErroTrabalhoIa("A classificação não possui evidência no título.");
    }
    return { sku: original.id, produto: item.produto, tecido: item.tecido, quantidade: original.quantidade };
  });
}

export const relatorioSkuIa: TipoTrabalhoIa = {
  tipo: TIPO_RELATORIO_SKU, promptPadrao: PROMPT_SKU_PADRAO,
  promptGeracao: PROMPT_SKU_GERACAO, promptRevisao: PROMPT_SKU_REVISAO,
  schemaSaida: z.toJSONSchema(saidaSkuIaSchema),
  async autorizar(db, escopo, acao) {
    const [usuario] = await db.consultar<{ ler: boolean; escrever: boolean; configurar: boolean }>(Prisma.sql`
      SELECT pode_visualizar_anotar_sku AS ler, pode_escrever_anotar_sku AS escrever, pode_editar_configuracao AS configurar
      FROM usuario WHERE id=${escopo.id}::uuid AND aplicativo_id=${escopo.aplicativoId}::uuid AND ativo`);
    if (!usuario?.ler || (acao === "executar" && !usuario.escrever) || (acao === "configurar" && !usuario.configurar)) throw new ErroTrabalhoIa("Você não tem permissão para esta operação.", 403);
  },
  async verificarOrigem(db, app, origem) {
    const [busca] = await db.consultar<{ id: string; temItens: boolean }>(Prisma.sql`
      SELECT b.id, EXISTS(SELECT 1 FROM itens_busca_sku i WHERE i.busca_id=b.id AND i.aplicativo_id=b.aplicativo_id) AS "temItens"
      FROM buscas_sku b WHERE b.id=${origem}::uuid AND b.aplicativo_id=${app}::uuid FOR SHARE`);
    if (!busca) throw new ErroTrabalhoIa("Busca não encontrada.", 404);
    if (!busca.temItens) throw new ErroTrabalhoIa("Esta busca não tem SKUs para gerar o relatório.");
  },
  async vincular(db, c) {
    await db.executar(Prisma.sql`INSERT INTO ia_relatorio_busca (trabalho_id,aplicativo_id,busca_id) VALUES (${c.trabalhoId}::uuid,${c.aplicativoId}::uuid,${c.origemId}::uuid)`);
  },
  async preparar(db, c, cursor) {
    const rows = await db.consultar<{ id: string; titulo: string; quantidade: bigint }>(Prisma.sql`
      WITH pagina AS (
        SELECT i.sku, sum(i.quantidade)::bigint AS quantidade FROM itens_busca_sku i
        WHERE i.busca_id=${c.origemId}::uuid AND i.aplicativo_id=${c.aplicativoId}::uuid
          AND (${cursor}::text IS NULL OR i.sku COLLATE "C" > ${cursor}::text COLLATE "C")
        GROUP BY i.sku ORDER BY i.sku COLLATE "C" LIMIT 51
      )
      SELECT pg.sku AS id, pg.quantidade,
        coalesce(nullif(btrim(p.titulo_final),''),nullif(btrim(tp.titulo),''),
          (SELECT nullif(btrim(i.titulo_produto),'') FROM itens_busca_sku i
           WHERE i.busca_id=${c.origemId}::uuid AND i.aplicativo_id=${c.aplicativoId}::uuid AND i.sku=pg.sku
             AND nullif(btrim(i.titulo_produto),'') IS NOT NULL ORDER BY i.pedido_olist_id LIMIT 1),'') AS titulo
      FROM pagina pg LEFT JOIN produto_olist p ON p.sku_final=pg.sku LEFT JOIN tipo_produto tp ON tp.sku=pg.sku
      ORDER BY pg.sku COLLATE "C" LIMIT 51`);
    const entrada: z.infer<typeof entradaSkuIaSchema> = [];
    let bytes = 2;
    for (const row of rows.slice(0, 50)) {
      const item = entradaSkuIaSchema.element.parse({ ...row, quantidade: Number(row.quantidade) });
      const tamanho = Buffer.byteLength(JSON.stringify(item)) + 1;
      if (entrada.length && bytes + tamanho > 64 * 1024) break;
      entrada.push(item); bytes += tamanho;
    }
    return { entrada, cursor: entrada.at(-1)?.id ?? cursor, fim: rows.length === entrada.length };
  },
  validar: validarRelatorioSkuIa,
  async publicar(db, c) {
    const [contagem] = await db.consultar<{ faltantes: number }>(Prisma.sql`SELECT count(*)::int AS faltantes FROM ia_lote WHERE trabalho_id=${c.trabalhoId}::uuid AND resultado IS NULL`);
    if (contagem.faltantes) throw new ErroTrabalhoIa("Há lotes pendentes de revisão.");
  },
};
