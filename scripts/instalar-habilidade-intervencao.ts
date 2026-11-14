// Gera SQL revisável; não acessa credenciais nem executa alterações no banco.
import { habilidadeIntervencao, nomeHabilidadeIntervencao, inicioIntervencao, fimIntervencao } from "../src/lib/automatizacao/intervencao-compartilhada";

const aplicativoId = process.argv[2];
if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(aplicativoId ?? "")) {
  throw new Error("Informe o UUID do aplicativo de destino.");
}
const literal = (texto: string) => `'${texto.replace(/'/g, "''")}'`;
const app = `${literal(aplicativoId)}::uuid`;
const nome = literal(nomeHabilidadeIntervencao);
const conteudo = literal(habilidadeIntervencao);
const bloco = literal(`\n\n${inicioIntervencao}\n${habilidadeIntervencao}\n${fimIntervencao}`);

console.log(`BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('habilidade-intervencao:' || ${app}::text, 0));
SELECT id FROM automatizacao_habilidade WHERE "aplicativoId" = ${app} ORDER BY id FOR UPDATE;
INSERT INTO automatizacao_habilidade ("aplicativoId", nome)
SELECT ${app}, ${nome}
WHERE NOT EXISTS (SELECT 1 FROM automatizacao_habilidade WHERE "aplicativoId" = ${app} AND nome = ${nome});

INSERT INTO automatizacao_habilidade_versao ("aplicativoId", "habilidadeId", numero, markdown)
SELECT h."aplicativoId", h.id, coalesce(v.numero, 0) + 1, ${conteudo}
FROM automatizacao_habilidade h
LEFT JOIN LATERAL (SELECT numero, markdown FROM automatizacao_habilidade_versao WHERE "habilidadeId" = h.id ORDER BY numero DESC LIMIT 1) v ON true
WHERE h."aplicativoId" = ${app} AND h.nome = ${nome} AND NOT h.arquivada
AND v.markdown IS DISTINCT FROM ${conteudo};

-- Compatibilidade com o executor já publicado: distribui uma cópia versionada.
-- O novo executor substitui esta cópia pelo módulo compartilhado atual na reserva.
INSERT INTO automatizacao_habilidade_versao ("aplicativoId", "habilidadeId", numero, markdown)
SELECT h."aplicativoId", h.id, v.numero + 1, v.markdown || ${bloco}
FROM automatizacao_habilidade h
JOIN LATERAL (SELECT numero, markdown FROM automatizacao_habilidade_versao WHERE "habilidadeId" = h.id ORDER BY numero DESC LIMIT 1) v ON true
WHERE h."aplicativoId" = ${app} AND h.nome <> ${nome} AND NOT h.arquivada
AND strpos(v.markdown, ${literal(inicioIntervencao)}) = 0
AND length(v.markdown || ${bloco}) <= 32000;
COMMIT;`);
