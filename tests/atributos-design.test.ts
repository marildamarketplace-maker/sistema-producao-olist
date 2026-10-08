import assert from "node:assert/strict";
import test from "node:test";
import { validarAnaliseVisualEstampa, analiseVisualEstampaStructuredOutput } from "../src/schemas/analiseVisualEstampaSchema";
import { construirTextoPesquisa } from "../src/services/construirTextoPesquisa";
import { criarAtualizacaoResultadoAnaliseIa } from "../src/services/mapearResultadoAnaliseIaEstampa";

const desconhecido = { estado: "INDETERMINADO", valores: [], motivo: "Preview sem detalhe suficiente", evidencias: [] };
const base = {
  titulo: "Floral barrado", descricao: "Flores aquareladas concentradas na borda lateral sobre fundo azul.", tema: "floral", subtemas: [],
  coresPrincipais: ["azul"], coresSecundarias: [], elementosVisuais: ["flores"], palavrasChave: ["floral", "barrado", "azul", "aquarelado"],
  ocasioes: [], categorias: ["botânico"], estilo: "delicado", tipoImagem: "ESTAMPA", conteudosImagem: ["ESTAMPA"],
  aplicacaoVisual: { presente: false, objetoFisicoVisivel: false, suporte: "NAO_APLICAVEL", descricao: null, evidencias: [] },
  segmentacaoBusca: { publicosSugeridos: [], contextosUso: [], afinidadesVisuais: [] },
  classificacaoTextil: { padroesTexteis: [{ termo: "floral", confianca: 0.9, evidencias: ["flores visíveis"] }] }, confianca: 0.9, confiancaTipoImagem: 0.9,
  composicaoVisual: { distribuicao: { estado: "IDENTIFICADO", valores: ["barrado"], motivo: null, evidencias: ["faixa lateral de flores"] }, orientacao: desconhecido, densidade: desconhecido },
  linguagemVisual: { estado: "IDENTIFICADO", valores: ["aquarelado"], motivo: null, evidencias: ["pinceladas translúcidas"] },
  aplicacoesSugeridas: { estado: "IDENTIFICADO", sugestoes: [{ termo: "moda praia", confianca: 0.75, evidencias: ["barrado para composição de peças"] }], motivo: null },
};

test("novo contrato mantém aplicação sugerida separada da observada e indexa atributos", () => {
  const analise = validarAnaliseVisualEstampa(base);
  assert.equal(analise.aplicacaoVisual.presente, false);
  const texto = construirTextoPesquisa({ composicaoVisual: analise.composicaoVisual, linguagemVisual: analise.linguagemVisual });
  assert.equal(texto, "barrado aquarelado");
  assert.doesNotMatch(texto, /moda praia|indeterminado|Preview/u);
  const atualizacao = criarAtualizacaoResultadoAnaliseIa({ provider: "teste", model: "teste", analyzedAt: new Date(0).toISOString(), promptVersion: "v8", fallbackUsed: false, fallbackReason: null, primaryModel: "teste", primaryAttempts: 1, data: analise, requestId: null, usage: { inputTokens: null, outputTokens: null, totalTokens: null } });
  const metadata = atualizacao.ai_metadata as { response: { composicaoVisual: unknown } };
  assert.deepEqual(metadata.response.composicaoVisual, analise.composicaoVisual);
});

test("estados condicionais exigem motivo, valores e evidências coerentes", () => {
  for (const linguagemVisual of [
    { ...base.linguagemVisual, evidencias: [] },
    { ...desconhecido, motivo: null },
    { ...desconhecido, valores: ["aquarelado"] },
    { ...base.linguagemVisual, valores: ["aquarelado", "aquarelado"] },
  ]) assert.throws(() => validarAnaliseVisualEstampa({ ...base, linguagemVisual }));
  for (const estado of ["AUSENTE", "NAO_APLICAVEL", "INDETERMINADO"]) {
    assert.doesNotThrow(() => validarAnaliseVisualEstampa({ ...base, linguagemVisual: { ...desconhecido, estado } }));
  }
});

test("novo contrato rejeita categorias, estilos e classificações não justificadas", () => {
  assert.throws(() => validarAnaliseVisualEstampa({ ...base, categorias: ["estampas"] }));
  assert.throws(() => validarAnaliseVisualEstampa({ ...base, estilo: "vibrante" }));
  assert.throws(() => validarAnaliseVisualEstampa({ ...base, composicaoVisual: null }));
  assert.throws(() => validarAnaliseVisualEstampa({ ...base, classificacaoTextil: { padroesTexteis: [{ termo: "floral", confianca: 0.9, evidencias: [] }] } }));
  assert.throws(() => validarAnaliseVisualEstampa({ ...base, aplicacoesSugeridas: { ...base.aplicacoesSugeridas, sugestoes: [{ termo: "moda praia", confianca: 0.9, evidencias: [] }] } }));
});

test("contrato remoto exige novos atributos e legado permanece legível", () => {
  const { composicaoVisual, linguagemVisual, aplicacoesSugeridas, ...legado } = base;
  assert.equal(validarAnaliseVisualEstampa(legado).composicaoVisual, undefined);
  const schema = analiseVisualEstampaStructuredOutput.jsonSchema as { required: string[] };
  for (const campo of ["composicaoVisual", "linguagemVisual", "aplicacoesSugeridas"]) assert.ok(schema.required.includes(campo));
  assert.ok(composicaoVisual && linguagemVisual && aplicacoesSugeridas);
});
