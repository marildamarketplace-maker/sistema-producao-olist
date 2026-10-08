import { readFile, readdir, mkdir, open, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { RegistroPiloto } from "./pilotoModelosEstampaService";
import { ErroEntradaPiloto } from "./diagnosticoPilotoEstampas";

const checkpointSchema = z.object({
  id: z.string(), imageHash: z.string(), promptHash: z.string(), schemaHash: z.string(), promptVersion: z.string(),
  configuracao: z.object({ model: z.string(), detail: z.enum(["low", "high", "auto"]), provider: z.enum(["openai", "gemini", "anthropic"]).optional(), thinkingLevel: z.enum(["low", "medium", "high"]).optional() }),
  maxOutputTokens: z.number().int().positive(), ok: z.boolean(), latencyMs: z.number(), custoEstimadoUsd: z.number().nullable(),
}).passthrough();

export function chaveResultadoPiloto(registro: Pick<RegistroPiloto, "id" | "imageHash" | "promptHash" | "schemaHash" | "configuracao" | "maxOutputTokens" | "promptVersion">) {
  return JSON.stringify([registro.id, registro.imageHash, registro.configuracao.model, registro.configuracao.detail,
    registro.promptVersion, registro.promptHash, registro.schemaHash, registro.maxOutputTokens, registro.configuracao.provider ?? "openai", registro.configuracao.thinkingLevel ?? null]);
}

export async function lerCheckpointsPiloto(pasta: string, incluirProviders = false, todasTentativas = false): Promise<RegistroPiloto[]> {
  if (incluirProviders) {
    const todos = [...await lerCheckpointsPiloto(pasta, false, todasTentativas), ...await lerCheckpointsPiloto(resolve(pasta, "gemini"), false, todasTentativas), ...await lerCheckpointsPiloto(resolve(pasta, "anthropic"), false, todasTentativas)];
    if (todasTentativas) return todos;
    return [...new Map(todos.map(registro => [chaveResultadoPiloto(registro), registro])).values()];
  }
  const registros = new Map<string, RegistroPiloto>();
  const historico: RegistroPiloto[] = [];
  const diretorios = await readdir(pasta, { withFileTypes: true }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  for (const diretorio of diretorios.filter(item => item.isDirectory() && /^piloto-estampas-\d+$/u.test(item.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    const arquivo = resolve(pasta, diretorio.name, "resultados.jsonl");
    for (const registro of await lerArquivoCheckpointsPiloto(arquivo)) {
      historico.push(registro);
      const chave = chaveResultadoPiloto(registro);
      if (!registros.get(chave)?.ok) registros.set(chave, registro);
    }
  }
  return todasTentativas ? historico : [...registros.values()];
}

export async function lerArquivoCheckpointsPiloto(arquivo: string, permitirCaudaIncompleta = true): Promise<RegistroPiloto[]> {
  let texto: string;
  try { texto = await readFile(arquivo, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const linhas = texto.split("\n");
  const registros: RegistroPiloto[] = [];
  for (const [indice, linha] of linhas.entries()) {
    if (!linha.trim()) continue;
    let valor: unknown;
    try { valor = JSON.parse(linha); }
    catch {
      if (permitirCaudaIncompleta && indice === linhas.length - 1 && !texto.endsWith("\n")) continue;
      throw new ErroEntradaPiloto(`Checkpoint inválido na linha ${indice + 1}. O arquivo foi preservado; corrija-o antes de retomar.`);
    }
    const parsed = checkpointSchema.safeParse(valor);
    if (!parsed.success) throw new ErroEntradaPiloto(`Checkpoint incompatível na linha ${indice + 1}.`);
    registros.push(parsed.data as RegistroPiloto);
  }
  return registros;
}

export async function assumirLockPiloto(pasta: string) {
  await mkdir(pasta, { recursive: true, mode: 0o700 });
  const arquivo = resolve(pasta, ".piloto-estampas.lock");
  const token = randomUUID();
  const criar = () => open(arquivo, "wx", 0o600);
  let handle;
  try { handle = await criar(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const anterior = JSON.parse(await readFile(arquivo, "utf8")) as { pid: number; host: string };
    let ativo = true;
    if (anterior.host === hostname() && Number.isSafeInteger(anterior.pid) && anterior.pid > 0) {
      try { process.kill(anterior.pid, 0); } catch (error) { ativo = (error as NodeJS.ErrnoException).code !== "ESRCH"; }
    }
    if (ativo) throw new ErroEntradaPiloto("Já existe um piloto em execução. Aguarde o processo encerrar antes de retomar.");
    // Não remover lock abandonado automaticamente: duas retomadas simultâneas
    // poderiam remover o lock recém-criado uma da outra.
    throw new ErroEntradaPiloto(`Lock de piloto abandonado. Remova ${arquivo} e execute novamente.`);
  }
  await handle.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), token }));
  await handle.close();
  return async () => {
    const atual = JSON.parse(await readFile(arquivo, "utf8")) as { token: string };
    if (atual.token === token) await unlink(arquivo);
  };
}
