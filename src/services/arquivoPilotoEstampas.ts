import { createHash, randomUUID } from "node:crypto";
import { open, rename, unlink, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ConfiguracaoPiloto, RegistroPiloto } from "./pilotoModelosEstampaService";
import { lerCheckpointsPiloto, lerArquivoCheckpointsPiloto } from "./checkpointPilotoEstampas";

export const DIRETORIO_PILOTO_UNIFICADO = "arquivo-pilotos/piloto-estampas";
export type TentativaPiloto = { hash: string; ok: boolean; erro?: string; custoEstimadoUsd: number | null; latencyMs: number; diagnostico?: RegistroPiloto["diagnostico"] };
export type RegistroPilotoUnificado = RegistroPiloto & { historicoTentativas?: TentativaPiloto[] };

// O sucesso vale para a imagem/configuração, mesmo após ajustes de prompt,
// schema e limite de saída. Uma imagem diferente continua sendo outra análise.
export function chaveCombinacaoPiloto(r: Pick<RegistroPiloto, "id" | "imageHash" | "configuracao">) {
  return JSON.stringify([r.id, r.imageHash, r.configuracao.provider ?? "openai", r.configuracao.model, r.configuracao.detail, r.configuracao.thinkingLevel ?? null]);
}

export function consolidarRegistrosPiloto(registros: readonly RegistroPilotoUnificado[]) {
  const mapa = new Map<string, RegistroPilotoUnificado>();
  for (const registro of registros) {
    const chave = chaveCombinacaoPiloto(registro);
    const anterior = mapa.get(chave);
    const tentativas = new Map((anterior?.historicoTentativas ?? []).map(t => [t.hash, t]));
    const { historicoTentativas, ...base } = registro;
    const novas = historicoTentativas?.length ? historicoTentativas : [{ hash: createHash("sha256").update(JSON.stringify(base)).digest("hex"), ok: registro.ok, erro: registro.erro, custoEstimadoUsd: registro.custoEstimadoUsd, latencyMs: registro.latencyMs, diagnostico: registro.diagnostico }];
    for (const tentativa of novas) tentativas.set(tentativa.hash, tentativa);
    // Nunca substituir uma resposta bem-sucedida por uma falha posterior.
    mapa.set(chave, { ...(anterior?.ok ? anterior : registro), historicoTentativas: [...tentativas.values()] });
  }
  return [...mapa.values()];
}

export function resumirPiloto(registros: readonly RegistroPilotoUnificado[]) {
  const configs = new Map<string, ConfiguracaoPiloto>();
  for (const r of registros) configs.set(JSON.stringify(r.configuracao), r.configuracao);
  return [...configs.values()].map(config => {
    const itens = registros.filter(r => (r.configuracao.provider ?? "openai") === (config.provider ?? "openai") && r.configuracao.model === config.model && r.configuracao.detail === config.detail && r.configuracao.thinkingLevel === config.thinkingLevel);
    const tentativas = itens.flatMap<Pick<TentativaPiloto, "custoEstimadoUsd" | "latencyMs">>(r => r.historicoTentativas ?? [r]);
    return { ...config, combinacoes: itens.length, chamadas: tentativas.length, respostasValidas: itens.filter(r => r.ok).length,
      aprovadasPelasRegras: itens.filter(r => r.qualidade && !r.qualidade.precisaRevisao).length, erros: itens.filter(r => !r.ok).length,
      latenciaMediaMs: tentativas.length ? tentativas.reduce((n, t) => n + t.latencyMs, 0) / tentativas.length : null,
      custoConhecidoUsd: tentativas.reduce((n, t) => n + (t.custoEstimadoUsd ?? 0), 0), chamadasSemCustoConhecido: tentativas.filter(t => t.custoEstimadoUsd === null).length,
      precisaoVisual: "PENDENTE_REVISAO_HUMANA" };
  });
}

export async function gravarArquivoAtomicoPiloto(path: string, conteudo: string) {
  const temporario = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporario, "wx", 0o600);
  try {
    await handle.writeFile(conteudo);
    await handle.sync();
    await handle.close();
    await rename(temporario, path);
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(temporario).catch(() => {});
    throw error;
  }
}

function identificarTentativa(registro: RegistroPilotoUnificado) {
  if (registro.tentativaId) return registro.tentativaId;
  const { historicoTentativas: _historico, ...base } = registro;
  void _historico;
  const ordenar = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordenar);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, ordenar(v)]));
    return value;
  };
  return createHash("sha256").update(JSON.stringify(ordenar(base))).digest("hex");
}

// Chamador deve possuir os locks: manter todos os bytes anteriores e acrescentar
// somente tentativas novas. A troca atômica evita uma linha parcial após Ctrl+C.
export async function gravarPilotoUnificado(pasta: string, novos: readonly RegistroPilotoUnificado[]) {
  await mkdir(pasta, { recursive: true, mode: 0o700 });
  const arquivo = resolve(pasta, "resultados.jsonl");
  const existentes = await lerArquivoCheckpointsPiloto(arquivo, false);
  const ids = new Set(existentes.map(identificarTentativa));
  const acrescentar = novos.filter(r => {
    const id = identificarTentativa(r);
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  });
  if (acrescentar.length) {
    const anterior = await readFile(arquivo, "utf8").catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    });
    const separador = anterior && !anterior.endsWith("\n") ? "\n" : "";
    await gravarArquivoAtomicoPiloto(arquivo, anterior + separador + acrescentar.map(r => JSON.stringify(r)).join("\n") + "\n");
  }
  const registros = consolidarRegistrosPiloto([...existentes, ...acrescentar]);
  await gravarArquivoAtomicoPiloto(resolve(pasta, "resumo.json"), JSON.stringify(resumirPiloto(registros), null, 2));
  return registros;
}

// Executar apenas com os locks dos três providers adquiridos. Não mover nem
// excluir arquivos legados: importar apenas tentativas ainda ausentes.
export async function unificarArquivosPiloto(raiz: string) {
  const pasta = resolve(raiz, DIRETORIO_PILOTO_UNIFICADO);
  const legados = [...await lerCheckpointsPiloto(raiz, true, true), ...await lerCheckpointsPiloto(resolve(raiz, "arquivo-pilotos"), true, true)];
  const registros = await gravarPilotoUnificado(pasta, legados);
  return { pasta, registros };
}
