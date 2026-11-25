import { z } from "zod";
import { normalizarDocumento } from "@/lib/documento-fiscal";

export const UFS_DIRECIONAMENTO = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const;
const ufSchema = z.enum(UFS_DIRECIONAMENTO);
const ufs = z.array(ufSchema).min(1).max(27).refine(v => new Set(v).size === v.length, "UF repetida.");
export const condicaoDirecionamentoSchema = z.discriminatedUnion("campo", [
  z.object({ campo: z.literal("UF_EM"), ufs }).strict(),
  z.object({ campo: z.literal("UF_FORA"), ufs }).strict(),
  z.object({ campo: z.literal("NOME_CONTEM"), texto: z.string().trim().min(1).max(100) }).strict(),
  z.object({ campo: z.literal("DOCUMENTO_TIPO"), tipo: z.enum(["CPF", "CNPJ"]) }).strict(),
]);
export const regraDirecionamentoSchema = z.object({
  id: z.guid(), nome: z.string().trim().min(1).max(100), ativa: z.boolean(), aplicativoId: z.guid(),
  combinacao: z.enum(["E", "OU"]), condicoes: z.array(condicaoDirecionamentoSchema).min(1).max(10),
}).strict();
export const configuracaoDirecionamentoSchema = z.object({
  versao: z.number().int().min(0).max(2147483647), aplicativoPadraoId: z.guid(),
  regras: z.array(regraDirecionamentoSchema).max(50).refine(v => new Set(v.map(r => r.id)).size === v.length, "Regras com identificador repetido."),
}).strict();
export const dadosClienteDirecionamentoSchema = z.object({
  nome: z.string().max(500), cpfCnpj: z.string().max(64).nullable(), uf: z.string().max(32).nullable(),
}).strict();
export const decisaoDirecionamentoSchema = z.object({
  tipo: z.enum(["REGRA", "PADRAO", "CONTA_UNICA"]), regraId: z.guid().nullable(), regraNome: z.string().max(100).nullable(),
  versao: z.number().int().nonnegative(), aplicativoId: z.guid(), motivo: z.string().max(300),
}).strict();
export type ConfiguracaoDirecionamento = z.infer<typeof configuracaoDirecionamentoSchema>;
export type DadosClienteDirecionamento = z.infer<typeof dadosClienteDirecionamentoSchema>;
export type DecisaoDirecionamento = z.infer<typeof decisaoDirecionamentoSchema>;
export type RegraDirecionamento = z.infer<typeof regraDirecionamentoSchema>;
type Condicao = z.infer<typeof condicaoDirecionamentoSchema>;

export function normalizarNomeDirecionamento(nome: string) {
  return nome.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("pt-BR");
}
/** Classificação fiscal das regras; não altera a identidade usada entre contas. */
export function classificarDocumentoDirecionamento(valor: string | null): "CPF" | "CNPJ" | null {
  const doc = normalizarDocumento(valor);
  return doc ? (doc.length === 11 ? "CPF" : "CNPJ") : null;
}
function corresponde(condicao: Condicao, cliente: DadosClienteDirecionamento) {
  if (condicao.campo === "DOCUMENTO_TIPO") return classificarDocumentoDirecionamento(cliente.cpfCnpj) === condicao.tipo;
  if (condicao.campo === "NOME_CONTEM") return normalizarNomeDirecionamento(cliente.nome).includes(normalizarNomeDirecionamento(condicao.texto));
  const uf = ufSchema.safeParse(cliente.uf?.trim().toUpperCase());
  if (!uf.success) return false;
  const presente = condicao.ufs.includes(uf.data);
  return condicao.campo === "UF_EM" ? presente : !presente;
}
export function avaliarDirecionamentoPedido(configuracao: ConfiguracaoDirecionamento, dados: DadosClienteDirecionamento): DecisaoDirecionamento {
  const config = configuracaoDirecionamentoSchema.parse(configuracao);
  const cliente = dadosClienteDirecionamentoSchema.parse(dados);
  const regra = config.regras.find(r => r.ativa && (r.combinacao === "E" ? r.condicoes.every(c => corresponde(c, cliente)) : r.condicoes.some(c => corresponde(c, cliente))));
  return regra ? { tipo: "REGRA", regraId: regra.id, regraNome: regra.nome, versao: config.versao, aplicativoId: regra.aplicativoId, motivo: `Regra: ${regra.nome}` }
    : { tipo: "PADRAO", regraId: null, regraNome: null, versao: config.versao, aplicativoId: config.aplicativoPadraoId, motivo: "Aplicativo padrão configurado pelo pai." };
}
