import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { executarPilotoModelosEstampa, CONFIGURACOES_PILOTO, CONFIGURACOES_PILOTO_ANTHROPIC, obterConfiguracoesPilotoGemini, type RegistroPiloto } from "@/services/pilotoModelosEstampaService";
import { obterConfiguracaoAnthropic } from "@/config/anthropic";
import { obterConfiguracaoGemini } from "@/config/gemini";
import { validarUrlPreviewEstampa } from "@/services/carregarPreviewEstampaService";
import { descreverErroPiloto, ErroEntradaPiloto } from "@/services/diagnosticoPilotoEstampas";
import { assumirLockPiloto } from "@/services/checkpointPilotoEstampas";
import { MAX_IMAGENS_PILOTO } from "@/config/pilotoEstampas";
import { gravarPilotoUnificado, gravarArquivoAtomicoPiloto, unificarArquivosPiloto } from "@/services/arquivoPilotoEstampas";

async function main() {
  const entrada = process.argv.slice(2);
  const seletores = entrada.filter(arg => arg.startsWith("--provider="));
  if (seletores.length > 1 || seletores.some(arg => !["--provider=gemini", "--provider=openai", "--provider=anthropic", "--provider=all"].includes(arg))) throw new ErroEntradaPiloto("Provider inválido; use all, openai, gemini ou anthropic.");
  const modo = seletores[0]?.split("=")[1] ?? "all";
  const usarOpenAI = modo === "all" || modo === "openai";
  const usarGemini = modo === "all" || modo === "gemini";
  const usarAnthropic = modo === "all" || modo === "anthropic";
  const args = entrada.filter(arg => !arg.startsWith("--provider="));
  if (args.includes("--help") || !args.length) {
    console.info("Uso: npm run piloto:estampas -- amostra.json [--executar]\nPadrão: completa as 7 configurações OpenAI + Gemini + Claude. Opcional: --provider=openai ou os comandos piloto:estampas:gemini e piloto:estampas:claude.\nSem --executar apenas valida a amostra. Usa um único relatório conjunto. Preserva ok:true, retenta ok:false e executa combinações ainda sem registro, sem alterar o catálogo.");
    return;
  }
  if (args.length > 2 || args[0]?.startsWith("--") || (args[1] && args[1] !== "--executar")) throw new ErroEntradaPiloto("Argumentos inválidos; use --help.");
  const amostra = z.array(z.object({ id: z.string().trim().min(1).max(120), preview_url: z.string() }).strict()).min(1).max(MAX_IMAGENS_PILOTO).parse(JSON.parse(await readFile(resolve(args[0]), "utf8")));
  if (new Set(amostra.map(item => item.id)).size !== amostra.length) throw new ErroEntradaPiloto("IDs duplicados na amostra.");
  amostra.forEach(item => validarUrlPreviewEstampa(item.preview_url));
  let configGemini: ReturnType<typeof obterConfiguracaoGemini> | undefined;
  if (usarGemini) {
    try { configGemini = obterConfiguracaoGemini(); }
    catch { throw new ErroEntradaPiloto("Configuração Gemini inválida. Confira GEMINI_THINKING_LEVEL, GEMINI_IMAGE_ANALYSIS_DETAIL, GEMINI_MAX_OUTPUT_TOKENS e GEMINI_IMAGE_ANALYSIS_TIMEOUT_MS."); }
  }
  let configAnthropic: ReturnType<typeof obterConfiguracaoAnthropic> | undefined;
  if (usarAnthropic) {
    try { configAnthropic = obterConfiguracaoAnthropic(); }
    catch { throw new ErroEntradaPiloto("Configuração Anthropic inválida. Confira ANTHROPIC_IMAGE_ANALYSIS_TIMEOUT_MS e ANTHROPIC_MAX_OUTPUT_TOKENS."); }
  }
  const configuracoes = [...(usarOpenAI ? CONFIGURACOES_PILOTO : []), ...(usarGemini ? obterConfiguracoesPilotoGemini() : []), ...(usarAnthropic ? CONFIGURACOES_PILOTO_ANTHROPIC : [])];
  console.info({ imagens: amostra.length, combinacoesTotais: amostra.length * configuracoes.length, configuracoes });
  if (!args.includes("--executar")) return;
  for (const chave of [...(usarOpenAI ? ["OPENAI_API_KEY"] : []), ...(usarGemini ? ["GEMINI_API_KEY"] : []), ...(usarAnthropic ? ["ANTHROPIC_API_KEY"] : [])]) {
    if (!process.env[chave]?.trim()) throw new ErroEntradaPiloto(`${chave} não configurada no ambiente carregado.`);
  }
  const raiz = fileURLToPath(new URL("../outputs/", import.meta.url));
  const liberarPrincipal = await assumirLockPiloto(raiz);
  const liberacoes = [liberarPrincipal];
  const liberar = async () => {
    const resultados = await Promise.allSettled([...liberacoes].reverse().map(fn => fn()));
    const falha = resultados.find(r => r.status === "rejected");
    if (falha?.status === "rejected") throw falha.reason;
  };
  try {
    for (const provider of ["gemini", "anthropic"]) liberacoes.push(await assumirLockPiloto(resolve(raiz, provider)));
  } catch (error) { await liberar(); throw error; }
  const encerrar = () => { liberar().finally(() => process.exit(130)); };
  process.once("SIGINT", encerrar);
  process.once("SIGTERM", encerrar);
  try {
    const unificado = await unificarArquivosPiloto(raiz);
    const anteriores = [...unificado.registros];
    const pasta = unificado.pasta;
    // Manifesto omite URLs, que podem conter assinaturas ou credenciais.
    const manifestoPath = resolve(pasta, "amostra.json");
    const manifestoAnterior = await readFile(manifestoPath, "utf8").catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "[]";
      throw error;
    });
    const idsAnteriores = z.array(z.object({ id: z.string() })).parse(JSON.parse(manifestoAnterior));
    const ids = [...new Set([...idsAnteriores.map(item => item.id), ...amostra.map(item => item.id)])];
    await gravarArquivoAtomicoPiloto(manifestoPath, JSON.stringify(ids.map(id => ({ id })), null, 2));
    console.info({ resultadosAnteriores: anteriores.length, aprovados: anteriores.filter(r => r.ok).length, pasta });
    let reutilizados = 0;
    let novos = 0;
    const providersIndisponiveis: string[] = [];
    const salvar = async (registro: RegistroPiloto) => {
      await gravarPilotoUnificado(pasta, [registro]);
      novos++;
      console.info({ id: registro.id, configuracao: registro.configuracao, ok: registro.ok, diagnostico: registro.diagnostico, reutilizado: false });
    };
    await executarPilotoModelosEstampa(amostra, salvar, { configuracoes, maxOutputTokensPorProvider: { gemini: configGemini?.maxOutputTokens, anthropic: configAnthropic?.maxOutputTokens }, anteriores,
      providerIndisponivel: provider => {
        providersIndisponiveis.push(provider);
        console.warn(`[piloto-estampas] ${provider}: acesso negado. Suspenso nesta execução; suas combinações continuam pendentes. Os outros providers continuam.`);
      },
      reutilizar: async () => { reutilizados++; } });
    console.info({ novos, reutilizados, providersIndisponiveis });
    console.info(`Relatório salvo em ${pasta}. Custos incluem erros quando há consumo informado; chamadas sem consumo ficam com custo desconhecido. Revisão visual humana permanece necessária.`);
  } finally {
    process.removeListener("SIGINT", encerrar);
    process.removeListener("SIGTERM", encerrar);
    await liberar();
  }
}
main().catch(error => { console.error(`[piloto-estampas] ${descreverErroPiloto(error)}`); process.exitCode = 1; });
