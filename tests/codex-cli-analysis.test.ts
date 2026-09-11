import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test, { type TestContext } from "node:test";
import { lerOpcoesEstampasWorker } from "../src/config/imageAnalysisProvider";
import { CodexLocalImageAnalysisProvider } from "../src/services/image-analysis/CodexLocalImageAnalysisProvider";
import { ImageAnalysisProviderError } from "../src/services/image-analysis/ImageAnalysisProviderError";
import { ambienteCodexCli } from "../src/services/image-analysis/executarCodexCli";
import { criarImageAnalysisProvider } from "../src/services/image-analysis/imageAnalysisProviderFactory";
import { OpenAIImageAnalysisProvider } from "../src/services/image-analysis/OpenAIImageAnalysisProvider";
import type { ImageAnalysisInput } from "../src/services/image-analysis/ImageAnalysisProvider";

const input: ImageAnalysisInput<{ description: string }> = {
  image: { buffer: Buffer.from("preview fixture"), mimeType: "image/png", sizeBytes: 15 },
  prompt: 'Analise a imagem; $(touch NAO_EXECUTAR) `echo segredo`',
  promptVersion: "v-test",
  output: {
    name: "test",
    jsonSchema: { type: "object", properties: { description: { type: "string" } }, required: ["description"], additionalProperties: false },
    parse(value: unknown) {
      assert.ok(typeof value === "object" && value !== null && "description" in value && typeof value.description === "string");
      return { description: value.description };
    },
  },
};

type Snapshot = { cwd: string; args: string[]; prompt: string; envKeys: string[]; image: string; schema: unknown; fileMode: number };

async function fixture(t: TestContext, config: Record<string, unknown> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "codex test "));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const executable = join(dir, "fake codex.cjs");
  const snapshot = join(dir, "snapshot.jsonl");
  const source = await readFile(resolve("tests/fixtures/codex-cli-fixture.cjs"), "utf8");
  await writeFile(executable, `#!${process.execPath}\n${source}`, { mode: 0o700 });
  await writeFile(join(dir, "config.json"), JSON.stringify({ ...config, snapshot }));
  const provider = new CodexLocalImageAnalysisProvider({ model: "test-model", executable, timeoutMs: 5_000 });
  return {
    executable, provider,
    async snapshots(): Promise<Snapshot[]> {
      return (await readFile(snapshot, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    },
  };
}

function erro(code: ImageAnalysisProviderError["code"], retriable?: boolean) {
  return (error: unknown) => {
    assert.ok(error instanceof ImageAnalysisProviderError);
    assert.equal(error.provider, "codex-local");
    assert.equal(error.code, code);
    if (retriable !== undefined) assert.equal(error.retriable, retriable);
    assert.ok(!error.message.includes("SECRET_TEST"));
    return true;
  };
}

test("seleção por argumento prevalece sobre ambiente e mantém API como padrão", () => {
  assert.equal(lerOpcoesEstampasWorker([], { NODE_ENV: "test" }).provider, "openai");
  assert.equal(lerOpcoesEstampasWorker([], { NODE_ENV: "test", IMAGE_ANALYSIS_PROVIDER: "codex-local" }).provider, "codex-local");
  assert.equal(lerOpcoesEstampasWorker(["--provider=openai"], { NODE_ENV: "test", IMAGE_ANALYSIS_PROVIDER: "codex-local" }).provider, "openai");
  assert.equal(lerOpcoesEstampasWorker(["--provider", "codex-local"]).provider, "codex-local");
  assert.throws(() => lerOpcoesEstampasWorker(["--provider=incorreto"]), /inválido/);
  assert.throws(() => lerOpcoesEstampasWorker(["--provider"]));
  assert.throws(() => lerOpcoesEstampasWorker(["--comando=rm"]));
});

test("ambiente do CLI exclui secrets e opções herdadas de execução", () => {
  const env = ambienteCodexCli({ NODE_ENV: "test", PATH: "/bin", HOME: "/home/test", CODEX_HOME: "/home/test/.codex", OPENAI_API_KEY: "SECRET_TEST", CODEX_API_KEY: "SECRET_TEST", POSTGRES_PRISMA_URL: "SECRET_TEST", SUPABASE_SERVICE_ROLE_KEY: "SECRET_TEST", NODE_OPTIONS: "--require malware", CODEX_THREAD_ID: "parent" });
  assert.deepEqual(env, { NODE_ENV: "test", PATH: "/bin", HOME: "/home/test", CODEX_HOME: "/home/test/.codex" });
});

test("CLI recebe imagem/schema reais, prompt por stdin e retorna contrato validado", async (t) => {
  const f = await fixture(t);
  await f.provider.verificarDisponibilidade();
  const result = await f.provider.analyzeImage(input);
  assert.equal(result.provider, "codex-local");
  assert.equal(result.model, "test-model");
  assert.equal(result.requestId, "thread-test");
  assert.deepEqual(result.data, { description: "flores" });
  assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 30, totalTokens: 150, cachedInputTokens: 100 });
  const [snapshot] = await f.snapshots();
  assert.equal(snapshot.image, input.image.buffer.toString("base64"));
  assert.deepEqual(snapshot.schema, input.output.jsonSchema);
  assert.ok(snapshot.prompt.startsWith(input.prompt));
  assert.ok(!snapshot.args.includes(input.prompt));
  assert.ok(snapshot.args.includes("read-only"));
  assert.ok(snapshot.args.includes('forced_login_method="chatgpt"'));
  assert.ok(snapshot.args.includes("features.shell_tool=false"));
  assert.ok(!snapshot.envKeys.includes("OPENAI_API_KEY"));
  assert.ok(!snapshot.envKeys.includes("POSTGRES_PRISMA_URL"));
  assert.equal(snapshot.fileMode, 0o600);
  await assert.rejects(access(snapshot.cwd));
});

test("jobs concorrentes têm diretórios exclusivos e limpam todos os temporários", async (t) => {
  const f = await fixture(t);
  await Promise.all([f.provider.analyzeImage(input), f.provider.analyzeImage(input)]);
  const snapshots = await f.snapshots();
  assert.equal(new Set(snapshots.map((x) => x.cwd)).size, 2);
  for (const snapshot of snapshots) await assert.rejects(access(snapshot.cwd));
});

for (const scenario of [
  { name: "JSON inválido", result: "not json", code: "INVALID_STRUCTURED_OUTPUT" },
  { name: "schema inválido", result: '{"description":42}', code: "INVALID_STRUCTURED_OUTPUT" },
  { name: "JSONL inválido", mode: "bad-events", code: "INVALID_RESPONSE" },
  { name: "execução incompleta", mode: "incomplete", code: "INVALID_RESPONSE" },
  { name: "resultado vazio", mode: "empty-result", code: "INVALID_RESPONSE" },
  { name: "saída excessiva", mode: "overflow", code: "INVALID_RESPONSE" },
  { name: "rate limit", mode: "exit", error: "429 rate limit SECRET_TEST", code: "RATE_LIMIT" },
  { name: "login expirado", mode: "exit", error: "401 authentication SECRET_TEST", code: "AUTHENTICATION_ERROR" },
  { name: "modelo indisponível", mode: "exit", error: "model is not supported SECRET_TEST", code: "CONFIGURATION_ERROR" },
  { name: "permissão local negada", mode: "exit", error: "Error: failed to initialize in-process app-server client: Operation not permitted SECRET_TEST", code: "CONFIGURATION_ERROR" },
  { name: "falha de rede", mode: "exit", error: "connection refused SECRET_TEST", code: "PROVIDER_TEMPORARY_ERROR" },
  { name: "turn.failed com exit zero", mode: "failed-event", error: "usage limit SECRET_TEST", code: "RATE_LIMIT" },
] as const) {
  test(`CLI rejeita ${scenario.name}, classifica o erro e limpa temporários`, async (t) => {
    const f = await fixture(t, scenario);
    await assert.rejects(f.provider.analyzeImage(input), erro(scenario.code));
    for (const snapshot of await f.snapshots()) await assert.rejects(access(snapshot.cwd));
  });
}

test("timeout encerra o processo e limpa o diretório", async (t) => {
  const f = await fixture(t, { mode: "timeout" });
  const provider = new CodexLocalImageAnalysisProvider({ executable: f.executable, model: "test", timeoutMs: 700 });
  await assert.rejects(provider.analyzeImage(input), erro("TIMEOUT", true));
  for (const snapshot of await f.snapshots()) await assert.rejects(access(snapshot.cwd));
});

test("preflight rejeita CLI antigo, login ausente e API key", async (t) => {
  const old = await fixture(t, { oldVersion: true });
  await assert.rejects(old.provider.verificarDisponibilidade(), erro("CONFIGURATION_ERROR", false));
  const api = await fixture(t, { auth: "Logged in using an API key SECRET_TEST" });
  await assert.rejects(api.provider.verificarDisponibilidade(), erro("AUTHENTICATION_ERROR", false));
  const absent = await fixture(t, { auth: "Not logged in", authExit: 1 });
  await assert.rejects(absent.provider.verificarDisponibilidade(), erro("AUTHENTICATION_ERROR", false));
});

test("configuração e executável inválidos falham sem chamada à API", async () => {
  assert.throws(() => new CodexLocalImageAnalysisProvider({ model: "x", timeoutMs: 0 }), erro("CONFIGURATION_ERROR"));
  assert.throws(() => new CodexLocalImageAnalysisProvider({ model: "x", timeoutMs: Number.NaN }), erro("CONFIGURATION_ERROR"));
  const provider = new CodexLocalImageAnalysisProvider({ model: "x", executable: "/nao-existe/codex" });
  await assert.rejects(provider.verificarDisponibilidade(), erro("CONFIGURATION_ERROR", false));
  await assert.rejects(provider.analyzeImage({ ...input, image: { ...input.image, buffer: Buffer.alloc(0) } }), erro("CONFIGURATION_ERROR"));
});

test("factory usa modelos próprios e nunca instancia API no modo Codex", () => {
  const original = { ...process.env };
  try {
    delete process.env.OPENAI_API_KEY;
    process.env.IMAGE_ANALYSIS_PROVIDER = "codex-local";
    process.env.CODEX_CLI_PRIMARY_MODEL = "cli-primary";
    process.env.CODEX_CLI_FALLBACK_MODEL = "cli-fallback";
    const primary = criarImageAnalysisProvider("primary");
    const fallback = criarImageAnalysisProvider("fallback");
    assert.ok(primary instanceof CodexLocalImageAnalysisProvider);
    assert.ok(fallback instanceof CodexLocalImageAnalysisProvider);
    assert.equal(primary.model, "cli-primary");
    assert.equal(fallback.model, "cli-fallback");
    process.env.CODEX_CLI_FALLBACK_MODEL = "cli-primary";
    assert.throws(() => criarImageAnalysisProvider(), /deve ser diferente/);
    process.env.IMAGE_ANALYSIS_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test";
    assert.ok(criarImageAnalysisProvider() instanceof OpenAIImageAnalysisProvider);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});

test("bootstrap aplica --provider antes do preflight e antes do acesso ao banco", async () => {
  const run = promisify(execFile);
  const env = { ...process.env, ESTAMPA_AI_PROCESSOR_MODE: "live", IMAGE_ANALYSIS_PROVIDER: "openai", OPENAI_API_KEY: "", CODEX_CLI_PATH: "/nao-existe/codex", POSTGRES_PRISMA_URL: "invalid", DOTENV_CONFIG_PATH: "/nao-existe/env" };
  const help = await run(process.execPath, ["--import", "tsx", "scripts/estampas-worker.ts", "--help"], { env });
  assert.match(help.stdout, /--provider/);
  await assert.rejects(run(process.execPath, ["--import", "tsx", "scripts/estampas-worker.ts", "--provider=codex-local"], { env }), (error: unknown) => {
    const stderr = (error as { stderr: string }).stderr;
    assert.match(stderr, /CODEX_CLI_PATH/);
    assert.doesNotMatch(stderr, /OPENAI_API_KEY|Prisma|POSTGRES_PRISMA_URL/);
    return true;
  });
});
