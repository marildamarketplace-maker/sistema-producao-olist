import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";

// Cliente em memória: nenhuma conexão ou credencial de banco é necessária.
let count = 1;
let versoesAtualizadas = 1;
let gravacao: Prisma.EstampaJobUpdateManyArgs | undefined;
let atualizacoesEstampa = 0;
const transaction = {
  estampaJob: { async updateMany(args: Prisma.EstampaJobUpdateManyArgs) { gravacao = args; return { count }; } },
  async $executeRaw() { atualizacoesEstampa++; return versoesAtualizadas; },
};
Object.assign(globalThis, { prisma: { $transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction) } });

test("conclusão registra o modelo efetivo e exige o lock do worker", async () => {
  const { concluirEstampaJob } = await import("../src/repositories/estampa-jobs-repository");
  for (const modelo of ["claude-haiku-5-5", "gpt-5.4-mini-real"]) {
    count = 1;
    assert.equal(await concluirEstampaJob("job-1", "worker-1", "123", "hash-1", modelo), true);
    assert.equal(gravacao?.data.modeloUtilizado, modelo);
    assert.deepEqual(gravacao?.where, { id: "job-1", workerId: "worker-1", estampaId: BigInt(123), status: "PROCESSING" });
  }
  count = 0;
  atualizacoesEstampa = 0;
  assert.equal(await concluirEstampaJob("job-1", "worker-2", "123", "hash-1", "claude-haiku-5-5"), false);
  assert.equal(atualizacoesEstampa, 0);
  count = 1;
  versoesAtualizadas = 0;
  await assert.rejects(concluirEstampaJob("job-1", "worker-1", "123", "hash-1", "claude-haiku-5-5"), /versão da estampa mudou/);
});
