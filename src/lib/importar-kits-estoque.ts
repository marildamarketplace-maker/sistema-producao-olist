import { z } from "zod";
import { composicaoKitSchema } from "./kits-estoque";

export type ComposicaoKit = z.infer<typeof composicaoKitSchema>;
export const loteKitsSchema = z.object({
  kits: z.array(composicaoKitSchema.refine((kit) => kit.componentes.length > 0, "Informe ao menos um componente por kit.")).min(1).max(500),
}).strict().superRefine(({ kits }, ctx) => {
  const vistos = new Set<string>();
  let total = 0;
  for (const kit of kits) {
    if (vistos.has(kit.sku)) ctx.addIssue({ code: "custom", message: `Kit ${kit.sku} repetido no lote.` });
    vistos.add(kit.sku);
    total += kit.componentes.length;
  }
  if (total > 2000) ctx.addIssue({ code: "custom", message: "Importe no máximo 2000 componentes por lote." });
});

/** CSV de uma linha por componente; aceita também colagem tabulada do Excel. */
export function lerLoteKits(texto: string): ComposicaoKit[] {
  if (texto.length > 1_000_000) throw new Error("O arquivo deve ter no máximo 1 MB de texto.");
  const linhas = texto.replace(/^\uFEFF/, "").split(/\r?\n/)
    .map((valor, index) => ({ valor, numero: index + 1 })).filter(({ valor }) => valor.trim());
  if (!linhas.length) throw new Error("Informe as linhas de associação dos kits.");
  const primeira = linhas[0].valor;
  const separador = primeira.includes("\t") ? "\t" : primeira.includes(";") ? ";" : ",";
  const kits = new Map<string, ComposicaoKit>();
  let total = 0;
  for (const { valor, numero } of linhas) {
    const campos: string[] = [];
    let campo = "", aspas = false;
    for (let i = 0; i < valor.length; i++) {
      if (valor[i] === '"') {
        if (aspas && valor[i + 1] === '"') { campo += '"'; i++; }
        else aspas = !aspas;
      } else if (valor[i] === separador && !aspas) { campos.push(campo.trim()); campo = ""; }
      else campo += valor[i];
    }
    if (aspas) throw new Error(`Linha ${numero}: feche as aspas do campo.`);
    campos.push(campo.trim());
    if (numero === linhas[0].numero && campos.join(";").toLowerCase() === "sku_kit;sku_componente;quantidade") continue;
    if (campos.length !== 3 || !campos[0] || !campos[1] || !/^\d+$/.test(campos[2])) {
      throw new Error(`Linha ${numero}: use sku_kit;sku_componente;quantidade inteira positiva.`);
    }
    const [sku, componente, quantidade] = campos;
    if (Number(quantidade) <= 0 || Number(quantidade) > 2147483647) {
      throw new Error(`Linha ${numero}: a quantidade deve ser inteira entre 1 e 2147483647.`);
    }
    if (sku.length > 255 || componente.length > 255) throw new Error(`Linha ${numero}: cada SKU deve ter no máximo 255 caracteres.`);
    const kit = kits.get(sku) ?? { sku, componentes: [] };
    if (kit.componentes.some((item) => item.sku === componente)) throw new Error(`Linha ${numero}: componente ${componente} repetido no kit ${sku}.`);
    if (kit.componentes.length >= 100) throw new Error(`Linha ${numero}: cada kit pode ter no máximo 100 componentes.`);
    kit.componentes.push({ sku: componente, quantidade: Number(quantidade) });
    const parsed = composicaoKitSchema.safeParse(kit);
    if (!parsed.success) throw new Error(`Linha ${numero}: ${parsed.error.issues[0].message}`);
    kits.set(sku, kit);
    total++;
    if (total > 2000 || kits.size > 500) throw new Error("Importe no máximo 500 kits e 2000 componentes por lote.");
  }
  const parsed = loteKitsSchema.safeParse({ kits: [...kits.values()] });
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data.kits;
}

export function validarLoteKits(
  kits: readonly ComposicaoKit[], produtosAtivos: ReadonlySet<string>,
  atuais: readonly { kitSku: string; sku: string }[],
) {
  const substituidos = new Set(kits.map((kit) => kit.sku));
  const finais = atuais.filter((item) => !substituidos.has(item.kitSku));
  for (const kit of kits) {
    for (const componente of kit.componentes) {
      if (!produtosAtivos.has(componente.sku)) throw new Error(`Kit ${kit.sku}: componente ${componente.sku} não é um produto ativo deste aplicativo.`);
      finais.push({ kitSku: kit.sku, sku: componente.sku });
    }
  }
  const skusKits = new Set(finais.map((item) => item.kitSku));
  for (const item of finais) {
    if (skusKits.has(item.sku)) throw new Error(`Kit ${item.kitSku}: ${item.sku} também é um kit. Associe somente produtos individuais.`);
  }
}
