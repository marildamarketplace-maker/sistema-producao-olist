import { z } from "zod";
import { interpretarIdMockup } from "./mockups";

import { MAX_ESTAMPAS_LAYOUT, MAX_ESTAMPAS_MOCKUPS, MAX_MODELOS_MOCKUPS, MAX_SAIDAS_MOCKUPS } from "./fila-mockups-contrato";

const estampaId = z.string().regex(/^[1-9]\d{0,18}$/).refine((id) => {
  return id.length < 19 || id <= "9223372036854775807";
});
const mockupId = z.string().max(608).refine((id) => interpretarIdMockup(id) !== null);

export const trabalhoFilaMockups = z.object({
  mockupId,
  estampaIds: z.array(estampaId).min(1).max(MAX_ESTAMPAS_LAYOUT),
}).refine(({ mockupId, estampaIds }) => (
  new Set(estampaIds).size === estampaIds.length
    && (interpretarIdMockup(mockupId)?.tipo === "LAYOUT" || estampaIds.length === 1)
));

export const pedidoFilaMockups = z.object({
  loteId: z.uuid(),
  estampas: z.array(estampaId).min(1).max(MAX_ESTAMPAS_MOCKUPS),
  trabalhos: z.array(trabalhoFilaMockups).min(1).max(MAX_SAIDAS_MOCKUPS),
}).superRefine(({ estampas, trabalhos }, ctx) => {
  const selecionadas = new Set(estampas);
  const usadas = new Set<string>();
  const modelos = new Set<string>();
  const chaves = new Set<string>();

  for (const trabalho of trabalhos) {
    const tipo = interpretarIdMockup(trabalho.mockupId)?.tipo;
    const ids = new Set(trabalho.estampaIds);
    const chave = tipo === "LAYOUT" ? trabalho.mockupId : `${trabalho.mockupId}/${trabalho.estampaIds[0]}`;
    if (chaves.has(chave)) {
      ctx.addIssue({ code: "custom", message: "Há combinações duplicadas ou incompatíveis com o tipo de mockup." });
      return;
    }
    chaves.add(chave);
    modelos.add(trabalho.mockupId);
    for (const id of ids) usadas.add(id);
  }

  if (modelos.size > MAX_MODELOS_MOCKUPS || selecionadas.size !== estampas.length
    || usadas.size !== selecionadas.size || estampas.some((id) => !usadas.has(id))) {
    ctx.addIssue({ code: "custom", message: "Vincule todas as estampas selecionadas e use até 24 mockups por lote." });
  }
});
