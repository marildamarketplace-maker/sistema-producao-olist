import { z } from "zod";
import { catalogoComercial } from "./catalogo";

export const LIMITE_REGISTROS_IMPORTACAO = 5000;
export const entradaImportacaoSchema = z.object({
  linhas: z.array(z.object({
    registro: z.number().int().min(2).max(5001), sku: z.string().trim().max(255),
    principal: z.string().trim().max(100), adicionais: z.string().max(1100), tipo: z.string().trim().max(100),
  }).strict()).max(LIMITE_REGISTROS_IMPORTACAO),
  incluirSugestoes: z.boolean(), incluirAdicionais: z.boolean(),
}).strict();
export type EntradaImportacao = z.infer<typeof entradaImportacaoSchema>;
export type VinculoImportacao = { sku: string; eventoId: string; existente: boolean };
export type PreviaImportacao = { registros: number; ignorados: number; duplicados: number;
  problemas: { registro: number; sku: string; motivo: string }[]; totalProblemas: number; vinculos: VinculoImportacao[] };
const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[_\s]+/g, " ").trim();

// RFC 4180: aspas escapadas, delimitador dentro das aspas e quebras de linha.
export function lerCsvAssociacoes(texto: string): EntradaImportacao["linhas"] {
  if (new TextEncoder().encode(texto).length > 5 * 1024 * 1024) throw new Error("O CSV deve ter até 5 MB.");
  texto = texto.replace(/^\uFEFF/, "");
  const cabecalho = texto.split(/\r?\n/, 1)[0];
  const delimitador = cabecalho.includes(";") ? ";" : ",";
  const registros: string[][] = []; let linha: string[] = [], campo = "", aspas = false, fechado = false;
  function guardar() { linha.push(campo); campo = ""; fechado = false; if (linha.length > 64) throw new Error("No máximo 64 colunas no CSV."); }
  function terminar() {
    guardar();
    if (linha.some(c => c.trim())) registros.push(linha);
    linha = [];
    if (registros.length > LIMITE_REGISTROS_IMPORTACAO + 1) throw new Error("Importe no máximo 5.000 registros por arquivo.");
  }
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else { aspas = false; fechado = true; } }
      else campo += c;
    } else if (c === delimitador) guardar();
    else if (c === "\n" || c === "\r") { if (c === "\r" && texto[i + 1] === "\n") i++; terminar(); }
    else if (c === '"' && !campo && !fechado) aspas = true;
    else { if (fechado || c === '"') throw new Error("CSV com aspas inválidas."); campo += c; }
    if (campo.length > 8192 || linha.length > 64) throw new Error("Campo ou quantidade de colunas excede o limite do CSV.");
  }
  if (aspas) throw new Error("CSV com aspas não fechadas.");
  if (campo || linha.length || fechado) terminar();
  if (registros.length < 2) throw new Error("O arquivo não contém produtos.");
  const headers = registros.shift()!.map(normalizar);
  if (new Set(headers).size !== headers.length) throw new Error("O CSV contém cabeçalhos duplicados.");
  const sku = headers.indexOf("sku"), principal = headers.indexOf("evento principal id");
  if (sku < 0 || principal < 0) throw new Error("Colunas obrigatórias: SKU e Evento principal ID.");
  const adicionais = headers.indexOf("eventos adicionais ids"), tipo = headers.indexOf("tipo associacao");
  return registros.map((r, i) => {
    if (r.length !== headers.length) throw new Error(`Registro ${i + 2}: quantidade de colunas inválida.`);
    return { registro: i + 2, sku: r[sku], principal: r[principal], adicionais: adicionais < 0 ? "" : r[adicionais], tipo: tipo < 0 ? "Direta" : r[tipo] };
  });
}

export async function prepararImportacao(entrada: EntradaImportacao, deps: {
  produtos: (skus: string[]) => Promise<{ id: string; sku: string; ativo: boolean }[]>;
  existentes: (vinculos: { produtoId: string; eventoId: string }[]) => Promise<{ produtoId: string; eventoId: string }[]>;
}): Promise<PreviaImportacao> {
  const previa: PreviaImportacao = { registros: entrada.linhas.length, ignorados: 0, duplicados: 0, problemas: [], totalProblemas: 0, vinculos: [] };
  const eventos = new Set(catalogoComercial.map(e => e.id));
  const candidatos: { registro: number; sku: string; eventoId: string }[] = [];
  function problema(registro: number, sku: string, motivo: string) {
    previa.totalProblemas++; if (previa.problemas.length < 100) previa.problemas.push({ registro, sku, motivo });
  }
  for (const r of entrada.linhas) {
    if (!r.principal) { previa.ignorados++; continue; }
    const tipo = normalizar(r.tipo);
    if (tipo === "sem evento especifico no calendario" || (tipo === "sugestao comercial" && !entrada.incluirSugestoes)) { previa.ignorados++; continue; }
    if (tipo !== "direta" && tipo !== "sugestao comercial") { problema(r.registro, r.sku, "Tipo de associação desconhecido. Use Direta ou Sugestão comercial."); continue; }
    if (!r.sku || !eventos.has(r.principal)) { problema(r.registro, r.sku, !r.sku ? "SKU vazio." : "Evento principal desconhecido."); continue; }
    const adicionais = entrada.incluirAdicionais ? r.adicionais.split("|").map(s => s.trim()).filter(Boolean) : [];
    if (adicionais.length > 10) { problema(r.registro, r.sku, "No máximo 10 eventos adicionais por registro."); continue; }
    for (const eventoId of new Set([r.principal, ...adicionais])) {
      if (!eventos.has(eventoId)) problema(r.registro, r.sku, `Evento adicional desconhecido: ${eventoId}.`);
      else candidatos.push({ registro: r.registro, sku: r.sku, eventoId });
    }
  }
  if (candidatos.length > 10000) throw new Error("A prévia aceita até 10.000 vínculos. Divida o arquivo.");
  const skus = [...new Set(candidatos.map(c => c.sku))];
  const produtos = skus.length ? await deps.produtos(skus) : [];
  const porSku = new Map(produtos.map(p => [p.sku, p]));
  const solicitados = new Map<string, { produtoId: string; eventoId: string }>();
  for (const c of candidatos) {
    const p = porSku.get(c.sku);
    if (p?.ativo) solicitados.set(`${p.id}:${c.eventoId}`, { produtoId: p.id, eventoId: c.eventoId });
  }
  const existentes = solicitados.size ? await deps.existentes([...solicitados.values()]) : [];
  const chavesExistentes = new Set(existentes.map(v => `${v.produtoId}:${v.eventoId}`));
  const vistos = new Set<string>();
  for (const c of candidatos) {
    const p = porSku.get(c.sku);
    if (!p?.ativo) { problema(c.registro, c.sku, "SKU não encontrado ou inativo neste aplicativo."); continue; }
    const chave = `${p.id}:${c.eventoId}`;
    if (vistos.has(chave)) { previa.duplicados++; continue; }
    vistos.add(chave); previa.vinculos.push({ sku: p.sku, eventoId: c.eventoId, existente: chavesExistentes.has(chave) });
  }
  return previa;
}
