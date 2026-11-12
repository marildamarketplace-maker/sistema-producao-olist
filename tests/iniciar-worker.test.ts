import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const launcher = readFileSync(join(process.cwd(), "iniciar-worker.sh"), "utf8");
const funcao = launcher.slice(launcher.indexOf("preparar_e_iniciar() {"), launcher.lastIndexOf("\npreparar_e_iniciar"));

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "iniciar-worker-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const remoto = join(root, "remote.git"), projeto = join(root, "checkout"), bin = join(root, "bin");
  const git = (args: string[], cwd = root) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git(["init", "--bare", remoto]);
  git(["clone", remoto, projeto]);
  git(["config", "user.email", "teste@example.invalid"], projeto);
  git(["config", "user.name", "Teste"], projeto);
  await writeFile(join(projeto, "iniciar-worker.sh"), launcher);
  await writeFile(join(projeto, "package-lock.json"), "{}");
  await writeFile(join(projeto, ".gitignore"), ".next/\n.cache/\n.turbo/\n");
  git(["add", "."], projeto);
  git(["commit", "-m", "fixture"], projeto);
  git(["push", "-u", "origin", "HEAD"], projeto);
  await mkdir(bin);
  const log = join(root, "commands.log"), workerEnv = join(root, "worker.env");
  await writeFile(workerEnv, "AUTOMATIZACAO_BROWSER_ARTIFACTS_DIR=/pasta/configurada\n");
  await writeFile(join(bin, "npm"), '#!/bin/bash\nprintf "npm %s\\n" "$*" >> "$TEST_LOG"\nif [[ "${TEST_FAIL_NPM:-}" == true ]]; then exit 1; fi\n', { mode: 0o755 });
  await writeFile(join(bin, "node"), '#!/bin/bash\nprintf "node\\n" >> "$TEST_LOG"\n', { mode: 0o755 });
  await mkdir(join(projeto, ".next"));
  await writeFile(join(projeto, ".next", "cache"), "regeneravel");
  const run = (failNpm = false) => spawnSync("bash", ["-c", `set -euo pipefail\n${funcao}\ncd -- "$project_dir"\npreparar_e_iniciar`], {
    cwd: projeto, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, project_dir: projeto, worker_env: workerEnv, TEST_LOG: log, TEST_FAIL_NPM: String(failNpm) },
  });
  return { root, projeto, git, log, workerEnv, run };
}

test("iniciador atualiza Git, limpa cache, recria dependências e preserva configuração", async (t) => {
  const f = await fixture(t);
  const r = f.run();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  await assert.rejects(access(join(f.projeto, ".next")));
  assert.equal(await readFile(f.workerEnv, "utf8"), "AUTOMATIZACAO_BROWSER_ARTIFACTS_DIR=/pasta/configurada\n");
  assert.equal(await readFile(f.log, "utf8"), "npm cache verify\nnpm ci --include=dev\nnode\nnode\nnode\n");
});

test("alteração local impede pull e instalação sem apagar arquivos", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.projeto, "package-lock.json"), "alteração local");
  const r = f.run();
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /alterações locais/);
  await assert.rejects(access(f.log));
  await access(join(f.projeto, ".next", "cache"));
});

test("commit local e falha de fetch impedem inicialização", async (t) => {
  const f = await fixture(t);
  f.git(["commit", "--allow-empty", "-m", "local"], f.projeto);
  assert.match(f.run().stdout, /commits locais/);
  f.git(["remote", "set-url", "origin", join(f.root, "nao-existe")], f.projeto);
  assert.notEqual(f.run().status, 0);
  await assert.rejects(access(f.log));
});

test("falha no npm impede iniciar o worker", async (t) => {
  const f = await fixture(t);
  assert.notEqual(f.run(true).status, 0);
  assert.doesNotMatch(await readFile(f.log, "utf8"), /node/);
});

test("pull aplica commit remoto antes de instalar", async (t) => {
  const f = await fixture(t);
  const produtor = join(f.root, "produtor");
  f.git(["clone", join(f.root, "remote.git"), produtor]);
  f.git(["config", "user.email", "teste@example.invalid"], produtor);
  f.git(["config", "user.name", "Teste"], produtor);
  await writeFile(join(produtor, "atualizacao.txt"), "nova versao");
  f.git(["add", "."], produtor);
  f.git(["commit", "-m", "atualizacao remota"], produtor);
  f.git(["push"], produtor);
  const r = f.run();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(await readFile(join(f.projeto, "atualizacao.txt"), "utf8"), "nova versao");
  assert.equal(f.git(["rev-parse", "HEAD"], f.projeto), f.git(["rev-parse", "HEAD"], produtor));
});
