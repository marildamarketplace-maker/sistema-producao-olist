import { AsyncLocalStorage } from "node:async_hooks";
import { beforeEach } from "node:test";

// Armazenamento isolado para executar unstable_cache real fora do servidor Next.
const entradas = new Map<string, unknown>();
Object.assign(globalThis, { AsyncLocalStorage, __incrementalCache: {
  generateSimpleCacheKey: async (chave: string) => chave,
  get: async (chave: string) => entradas.has(chave) ? { value: entradas.get(chave), isStale: false } : null,
  set: async (chave: string, value: unknown) => { entradas.set(chave, value); },
} });
beforeEach(() => entradas.clear());
