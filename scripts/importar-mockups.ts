import { config as carregarVariaveis } from "dotenv";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { prepararImagemMockup } from "@/lib/mockups-imagem";
import { MockupBlobStorageError, mockupBlobStorage } from "@/services/mockupBlobStorageService";
import type { TipoMockup } from "@/lib/mockups";

carregarVariaveis({ path: ".env.local", quiet: true });
carregarVariaveis({ quiet: true });

const extensoesImagem = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const aplicativoPadrao = "00000000-0000-0000-0000-000000000001";

function argumento(nome: string) {
  const prefixo = `--${nome}=`;
  return process.argv.find((item) => item.startsWith(prefixo))?.slice(prefixo.length);
}

function slug(valor: string) {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "geral";
}

function nomeLegivel(arquivo: string) {
  const semExtensao = path.basename(arquivo, path.extname(arquivo));
  const nome = semExtensao
    .replace(/^mockup-kit-\d+-/i, "kit-")
    .replace(/^mockup-\d+-/i, "")
    .replace(/^layout-variantes-/i, "variantes-")
    .replace(/^informativo-/i, "")
    .replace(/-/g, " ");
  return nome.charAt(0).toLocaleUpperCase("pt-BR") + nome.slice(1);
}

function tipoDoArquivo(caminhoRelativo: string): TipoMockup {
  if (caminhoRelativo.split(path.sep).some((parte) => parte.toLocaleLowerCase("pt-BR") === "informativos")) return "INFORMATIVO";
  return path.basename(caminhoRelativo).toLocaleLowerCase("pt-BR").startsWith("layout-") ? "LAYOUT" : "INDIVIDUAL";
}

function observacaoDoPrompt(categoria: string, nomeArquivo: string, tipo: TipoMockup) {
  if (tipo === "INFORMATIVO") return "";
  const arquivo = nomeArquivo.toLocaleLowerCase("pt-BR");
  if (tipo === "LAYOUT") {
    return "Este arquivo contém vários quadros de produtos. Aplique uma estampa por quadro, na ordem de leitura da esquerda para a direita e de cima para baixo. Preserve a grade, os separadores e a identidade de cada quadro. Não altere textos informativos, medidas ou elementos gráficos que não sejam tecido.";
  }
  if (categoria === "FMR") return "Forro retangular de mesa: aplique a estampa no tampo e mantenha a continuidade nas laterais caídas, acompanhando perspectiva, dobras e bordas. Preserve a peça e o cenário. Acabamento de corte a laser, sem inventar bainha, costura ou barrado.";
  if (categoria === "REDONDO") return "Forro redondo de mesa: aplique a estampa por toda a superfície de tecido, acompanhando o formato circular, as dobras e a perspectiva. Não crie barrado, bainha ou costura; preserve o corte a laser e o cenário.";
  if (categoria === "LENÇO") return arquivo.includes("2x2") || arquivo.includes("usos-variados")
    ? "Lenço de tecido leve: aplique a mesma estampa em cada representação do lenço, mantendo o desenho coerente com cada dobra, amarração e ângulo. Não reconstrua a arte inteira em cada área visível nem acrescente acabamento."
    : "Lenço quadrado de tecido leve: substitua a estampa somente no tecido. Em dobras, nós ou amarrações, mantenha a perspectiva e mostre apenas a parte correspondente da arte; preserve corte a laser sem bainha ou costura.";
  if (categoria === "PAREO") return "Pareô quadrado de tecido leve: aplique a estampa na superfície do tecido e faça o desenho acompanhar dobras, nós e caimento. Preserve a perspectiva e o acabamento de corte a laser, sem inventar bainha ou costura.";
  if (categoria === "KIT-LENÇO-PAREO") return "Kit com lenço e pareô: aplique a mesma estampa do arquivo de arte nos componentes têxteis visíveis, respeitando o tamanho e a dobra de cada peça. Preserve a composição do kit e não misture a estampa com o cenário ou acessórios.";
  if (categoria === "FORRINHO") return "Forrinho quadrado de 45 × 45 cm: aplique a estampa apenas no tecido e acompanhe a forma como ele cobre a cesta, mesa, fogão ou micro-ondas. Preserve a peça sem adicionar renda, barra, costura ou bainha; o acabamento é corte a laser.";
  if (categoria === "PAINEL") return "Painel têxtil: substitua a estampa somente na área de tecido do painel, acompanhando o plano, a perspectiva e as ondulações leves. Preserve suportes, molduras, cenário e proporções da peça; não copie elementos decorativos da foto para a estampa.";
  if (categoria === "TECIDO-CORRIDO") return "Tecido vendido por metro linear: aplique a arte na superfície contínua do tecido, preservando escala, orientação e cores. Não invente rapport ou repetição que não esteja visível na arte; mantenha o enquadramento e o cenário.";
  return "Aplique a arte somente sobre a área de tecido do produto. Preserve a forma, as dobras, a perspectiva, o caimento, os acabamentos e o cenário da imagem de referência; não acrescente textos, bordas, costuras ou elementos que não existam.";
}

async function arquivosImagem(diretorio: string, atual = ""): Promise<string[]> {
  const itens = await readdir(path.join(diretorio, atual), { withFileTypes: true });
  const caminhos = await Promise.all(itens.map(async (item) => {
    const relativo = path.join(atual, item.name);
    if (item.isDirectory()) return arquivosImagem(diretorio, relativo);
    if (item.isFile() && extensoesImagem.has(path.extname(item.name).toLowerCase())) return [relativo];
    return [];
  }));
  return caminhos.flat();
}

async function importarArquivos(diretorio: string, aplicativoId: string, limite?: number) {
  const caminhosCompletos = await arquivosImagem(diretorio);
  const caminhos = limite ? caminhosCompletos.slice(0, limite) : caminhosCompletos;
  let enviados = 0;
  let jaExistiam = 0;
  const registros: Array<{ id: string; nome: string; tipo: TipoMockup; categoria: string; observacaoPrompt: string; storagePath: string }> = [];
  for (const relativo of caminhos) {
    const arquivo = path.join(diretorio, relativo);
    const bytes = await readFile(arquivo);
    if (bytes.length > 4 * 1024 * 1024) throw new Error(`${relativo}: excede 4 MB.`);
    const partes = relativo.split(path.sep);
    const pastaInformativos = partes.findIndex((parte) => parte.toLocaleLowerCase("pt-BR") === "informativos");
    const categoria = partes[pastaInformativos > 0 ? pastaInformativos - 1 : 0] ?? "GERAL";
    const tipo = tipoDoArquivo(relativo);
    const nome = nomeLegivel(arquivo);
    const observacaoPrompt = observacaoDoPrompt(categoria, relativo, tipo);
    const request = new Request("http://localhost/importar-mockup", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-mockup-nome": encodeURIComponent(nome),
        "x-mockup-tipo": tipo,
        "x-mockup-categoria": encodeURIComponent(categoria),
        "x-mockup-observacao-prompt": encodeURIComponent(observacaoPrompt),
      },
      body: new Uint8Array(bytes),
    });
    const preparado = await prepararImagemMockup(request);
    const categoriaPath = slug(categoria);
    const storagePath = tipo === "INFORMATIVO"
      ? `mockups/${aplicativoId}/informativos/${categoriaPath}/${preparado.id}.webp`
      : `mockups/${aplicativoId}/${preparado.id}.webp`;
    try {
      await mockupBlobStorage.enviar({
        path: storagePath,
        buffer: preparado.imagem,
        contentType: "image/webp",
        somenteNovo: true,
        signal: AbortSignal.timeout(30_000),
      });
      enviados += 1;
    } catch (error) {
      if (!(error instanceof MockupBlobStorageError) || error.status !== 412) throw error;
      jaExistiam += 1;
    }
    registros.push({ id: preparado.id, nome, tipo, categoria, observacaoPrompt, storagePath });
    console.error(`Arquivo verificado ${registros.length}/${caminhos.length}.`);
  }
  return { total: caminhos.length, enviados, jaExistiam, registros };
}

async function main() {
  const diretorio = argumento("source") ?? process.env.MOCKUPS_IMPORT_DIR;
  const aplicativoId = argumento("aplicativoId") ?? aplicativoPadrao;
  if (!diretorio) throw new Error("Informe --source=/caminho/da/pasta.");
  const dadosDir = await stat(diretorio);
  if (!dadosDir.isDirectory()) throw new Error("A origem precisa ser uma pasta.");
  const limiteInformado = Number(argumento("limit"));
  const limite = Number.isInteger(limiteInformado) && limiteInformado > 0 ? limiteInformado : undefined;
  const resultado = await importarArquivos(diretorio, aplicativoId, limite);
  console.log(JSON.stringify({
    resumo: { arquivos: resultado.total, enviados: resultado.enviados, jaExistiam: resultado.jaExistiam },
    registros: resultado.registros,
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Falha ao importar os arquivos.");
  process.exitCode = 1;
});
