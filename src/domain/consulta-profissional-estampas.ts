import { expandirConsultaComVocabularioTextil } from "@/domain/estampa-taxonomia-textil";

const PALAVRAS_LIGACAO = new Set(["a", "as", "o", "os", "de", "da", "das", "do", "dos", "e", "com", "em", "no", "na", "nos", "nas", "para", "por", "um", "uma", "uns", "umas"]);
const EXPRESSOES = [
  "sem direção dominante", "pied de poule", "animal print", "polka dots", "polka dot",
  "tie dye", "zigue zague", "traço manual", "textura simulada", "moda praia",
  ...["azul", "verde", "rosa", "amarelo", "amarela", "vermelho", "vermelha", "roxo", "roxa", "marrom", "cinza"].flatMap((cor) =>
    ["claro", "clara", "escuro", "escura"].map((tom) => `${cor} ${tom}`)),
].sort((a, b) => b.split(" ").length - a.split(" ").length);

const GRUPOS_CORES = [
  ...["amarel", "vermelh", "rox", "pret", "branc", "dourad", "pratead"].map((raiz) => ["o", "a", "os", "as"].map((fim) => `${raiz}${fim}`)),
  ["azul", "azuis"], ["marrom", "marrons"],
];

export type CriterioConsultaEstampas = { termo: string; consulta: string; codigo: { codigo: string; variante: string | null } | null };
export type PlanoConsultaEstampas = { positivos: CriterioConsultaEstampas[]; excluidos: CriterioConsultaEstampas[] };
export type CorrespondenciaEstampa = { percentual: number; termosEncontrados: string[]; termosAusentes: string[] };

const normalizar = (texto: string) => texto.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().trim().replace(/\s+/gu, " ");

export function extrairReferenciaCodigo(consulta: string) {
  const match = consulta.trim().match(/^((?:[\p{L}]{1,8})?[0-9][\p{L}\p{N}.]*)(?:[\s/-]+([\p{L}\p{N}]+))?$/u);
  return match ? { codigo: match[1], variante: match[2] ?? null } : null;
}

export function planejarConsultaEstampas(consulta: string): PlanoConsultaEstampas {
  const texto = consulta.trim().replace(/\s+/gu, " ");
  if (!texto) return { positivos: [], excluidos: [] };
  if ((texto.match(/"/gu)?.length ?? 0) % 2) throw new Error("Feche as aspas da frase pesquisada.");
  if (extrairReferenciaCodigo(texto)) return { positivos: [criterio(texto)], excluidos: [] };

  const tokens = [...texto.matchAll(/(-?)(?:"([^"]+)"|([\p{L}\p{N}][\p{L}\p{N}.'/-]*))/gu)]
    .map((match) => ({ termo: (match[2] ?? match[3]).replace(/^[.,]+|[.,]+$/gu, ""), excluir: Boolean(match[1]), frase: match[2] !== undefined }));
  const positivos = new Map<string, CriterioConsultaEstampas>();
  const excluidos = new Map<string, CriterioConsultaEstampas>();
  let excluirProximo = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = { ...tokens[i] };
    if (!token.frase) {
      const expressao = EXPRESSOES.find((item) => {
        const palavras = item.split(" ");
        return palavras.every((palavra, offset) => tokens[i + offset] && !tokens[i + offset].frase
          && (offset === 0 || !tokens[i + offset].excluir)
          && normalizar(tokens[i + offset].termo) === normalizar(palavra));
      });
      if (expressao) {
        const tamanho = expressao.split(" ").length;
        token.termo = tokens.slice(i, i + tamanho).map((item) => item.termo).join(" ");
        i += tamanho - 1;
      }
    }
    const termo = normalizar(token.termo);
    if (!token.frase && termo === "sem") { excluirProximo = true; continue; }
    if (!termo || (!token.frase && PALAVRAS_LIGACAO.has(termo))) continue;
    const item = criterio(token.termo, token.frase);
    const grupo = token.excluir || excluirProximo ? excluidos : positivos;
    const chave = item.codigo ? normalizar(item.termo) : normalizar(item.consulta);
    if (!grupo.has(chave)) grupo.set(chave, item);
    excluirProximo = false;
  }
  if (excluirProximo) throw new Error("Informe o termo que deseja excluir após “sem”.");
  if (!positivos.size) throw new Error("Informe ao menos um termo de busca além de palavras de ligação ou exclusões.");
  if ([...positivos.keys()].some((chave) => excluidos.has(chave))) throw new Error("Um mesmo critério não pode ser incluído e excluído na pesquisa.");
  if (positivos.size + excluidos.size > 12) throw new Error("Use no máximo 12 critérios na pesquisa geral; refine também pelos filtros.");
  return { positivos: [...positivos.values()], excluidos: [...excluidos.values()] };
}

function criterio(termo: string, literal = false): CriterioConsultaEstampas {
  const grupoCor = GRUPOS_CORES.find((grupo) => grupo.includes(normalizar(termo)));
  const expandida = expandirConsultaComVocabularioTextil(termo);
  const frase = `"${termo.replace(/["\\]/gu, " ")}"`;
  // Frases são um único critério e preservam a ordem/adjacência de seus termos.
  const consulta = literal ? frase : grupoCor ? grupoCor.map((cor) => `"${cor}"`).join(" OR ")
    : termo.includes(" ") && !expandida.includes(" OR ") ? frase : expandida;
  return { termo, codigo: extrairReferenciaCodigo(termo), consulta };
}

export function calcularPercentualCorrespondencia(encontrados: number, total: number) {
  return total > 0 ? Math.round(encontrados * 1000 / total) / 10 : 0;
}
