import { Prisma } from "@prisma/client";
import type { SqlIa } from "./banco";
import type { LinhaRelatorioIa } from "./relatorio-sku";
import { ErroTrabalhoIa } from "./contrato";
import { ORDENACAO_SKU_PADRAO, type OrdenacaoSku } from "../anotar-sku/ordenacao";

// Somente fragmentos SQL estáticos; parâmetros do cliente nunca viram identificadores.
const camposOrdenacao = {
  sku: Prisma.sql`lower(item->>'sku')`, produto: Prisma.sql`nullif(lower(item->>'produto'),'')`,
  tecido: Prisma.sql`nullif(lower(item->>'tecido'),'')`, quantidade: Prisma.sql`(item->>'quantidade')::bigint`,
};
export async function lerRelatorioIa(db:SqlIa, app:string,busca:string,trabalho:string|undefined,offset:number,limite=50,ordem:OrdenacaoSku=ORDENACAO_SKU_PADRAO) {
  const direcao = ordem.direcao === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const [relatorio]=await db.consultar<{id:string;total:number;criadoEm:Date;finalizadoEm:Date;revisaoConfig:number}>(Prisma.sql`
    SELECT t.id,t.total,t.criado_em AS "criadoEm",t.finalizado_em AS "finalizadoEm",t.revisao_config AS "revisaoConfig"
    FROM ia_trabalho t JOIN ia_relatorio_busca r ON r.trabalho_id=t.id AND r.aplicativo_id=t.aplicativo_id
    WHERE r.aplicativo_id=${app}::uuid AND r.busca_id=${busca}::uuid AND t.status='CONCLUIDO'
      AND (${trabalho??null}::uuid IS NULL OR t.id=${trabalho??null}::uuid)
    ORDER BY t.criado_em DESC,t.id DESC LIMIT 1`);
  if (!relatorio) throw new ErroTrabalhoIa("Nenhum relatório concluído disponível.",404);
  const itens=await db.consultar<LinhaRelatorioIa>(Prisma.sql`
    SELECT item->>'sku' AS sku,item->>'produto' AS produto,item->>'tecido' AS tecido,(item->>'quantidade')::double precision AS quantidade
    FROM ia_lote l CROSS JOIN LATERAL jsonb_array_elements(l.resultado) item
    WHERE l.trabalho_id=${relatorio.id}::uuid AND l.aplicativo_id=${app}::uuid
    ORDER BY ${camposOrdenacao[ordem.coluna]} ${direcao} NULLS LAST,item->>'produto',item->>'sku' COLLATE "C" LIMIT ${limite} OFFSET ${offset}`);
  return {...relatorio,criadoEm:relatorio.criadoEm.toISOString(),finalizadoEm:relatorio.finalizadoEm.toISOString(),itens,
    proximaPagina:offset+itens.length<relatorio.total ? offset+itens.length : null};
}
