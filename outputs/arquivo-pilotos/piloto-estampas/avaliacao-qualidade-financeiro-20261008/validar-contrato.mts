import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { analiseVisualEstampaStructuredOutput } from '../../../../src/schemas/analiseVisualEstampaSchema';
import { avaliarQualidadeMetadados } from '../../../../src/services/avaliarQualidadeMetadados';
import { construirTextoPesquisa } from '../../../../src/services/construirTextoPesquisa';
import { obterPrecosModeloAnaliseIa, calcularCustoEstimadoAnaliseIa } from '../../../../src/services/metricasCustoAnaliseIa';
const base = new URL('./', import.meta.url);
const rows = (await readFile(new URL('snapshot.jsonl', base),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
const audits=[];
for (const [index,row] of rows.entries()) {
 if (!row.ok) continue;
 const data=row.resultado?.data;
 let parsed; let issues;
 try {parsed=analiseVisualEstampaStructuredOutput.parse(data);} catch(error:any){issues=error.issues?.map((p:any)=>({code:p.code,path:p.path}));}
 const usage=row.resultado.usage;
 const prices=obterPrecosModeloAnaliseIa(row.resultado.model,row.resultado.analyzedAt,usage.inputTokens);
 const estimated=prices&&usage.inputTokens!==null&&usage.outputTokens!==null?calcularCustoEstimadoAnaliseIa(usage,prices).estimatedCostUsd:null;
 const d=parsed??data;
 const indexData={...d,padroesTexteis:d.classificacaoTextil.padroesTexteis.map((t:any)=>t.termo),publicosSugeridos:d.segmentacaoBusca.publicosSugeridos.map((t:any)=>t.termo),contextosUso:d.segmentacaoBusca.contextosUso.map((t:any)=>t.termo),afinidadesVisuais:d.segmentacaoBusca.afinidadesVisuais.map((t:any)=>t.termo),suporteAplicacao:d.aplicacaoVisual.suporte,descricaoAplicacao:d.aplicacaoVisual.descricao};
 audits.push({linha:index+1,id:row.id,configuracao:row.configuracao,contratoValido:!!parsed,issues,qualidadeAtual:parsed?avaliarQualidadeMetadados(parsed):null,custoRecalculadoUsd:estimated,diferencaCusto:estimated!==null&&row.custoEstimadoUsd!==null?estimated-row.custoEstimadoUsd:null,textoPesquisa:construirTextoPesquisa(indexData)});
}
await writeFile(new URL('validacoes-contrato.json',base),JSON.stringify(audits,null,2)+'\n');
console.log(JSON.stringify({sucessos:audits.length,contratosInvalidos:audits.filter(a=>!a.contratoValido).length,custosDivergentes:audits.filter(a=>a.diferencaCusto!==null&&Math.abs(a.diferencaCusto)>1e-9).length,arquivo:fileURLToPath(new URL('validacoes-contrato.json',base))}));
