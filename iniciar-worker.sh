#!/usr/bin/env bash
set -euo pipefail

# Abre um terminal quando iniciado pelo gerenciador de arquivos do Ubuntu/XFCE.
if [[ ! -t 0 || ! -t 1 ]]; then
  script_path="$(readlink -f -- "$0")"
  if command -v xfce4-terminal >/dev/null 2>&1; then
    exec xfce4-terminal --hold --execute bash "$script_path"
  elif command -v x-terminal-emulator >/dev/null 2>&1; then
    exec x-terminal-emulator -e bash "$script_path"
  fi
  exit 1
fi

trap 'codigo=$?; if (( codigo != 0 )); then printf "\nNão foi possível iniciar o worker. Confira o erro acima.\n"; read -r -p "Pressione Enter para fechar..." || true; fi' EXIT

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$script_dir"
if [[ ! -f "$project_dir/scripts/automatizacao-worker.ts" ]]; then
  project_dir="$HOME/sistema-producao-olist"
fi
if [[ ! -f "$project_dir/scripts/automatizacao-worker.ts" ]]; then
  printf 'Projeto não encontrado. Coloque este arquivo na pasta sistema-producao-olist.\n'
  exit 1
fi
worker_env="$HOME/.config/meury-worker/worker.env"
if [[ ! -f "$worker_env" ]]; then
  printf 'Configuração não encontrada: %s\n' "$worker_env"
  exit 1
fi
command -v node >/dev/null 2>&1 || { printf 'Node.js não encontrado.\n'; exit 1; }
command -v npm >/dev/null 2>&1 || { printf 'npm não encontrado.\n'; exit 1; }
command -v git >/dev/null 2>&1 || { printf 'Git não encontrado.\n'; exit 1; }
command -v flock >/dev/null 2>&1 || { printf 'flock não encontrado (pacote util-linux).\n'; exit 1; }
cd -- "$project_dir"
project_dir="$(pwd -P)"
# Impede duas instâncias iniciadas por este arquivo para o mesmo usuário.
exec 9>"$HOME/.config/meury-worker/iniciar-worker.lock"
if ! flock -n 9; then
  printf 'Já existe um worker iniciado por este arquivo. Use o terminal que está aberto.\n'
  exit 1
fi
# O corpo fica inteiramente carregado antes do pull, que pode alterar este arquivo.
preparar_e_iniciar() {
  project_dir="$(pwd -P)"
  printf '\n[1/5] Conferindo o repositório...\n'
  git rev-parse --is-inside-work-tree >/dev/null
  if [[ "$(git rev-parse --show-toplevel)" != "$project_dir" ]]; then
    printf 'A pasta do projeto precisa ser a raiz do repositório Git.\n'
    return 1
  fi
  if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
    printf 'Há alterações locais ou arquivos não rastreados. A atualização foi interrompida para preservá-los.\n'
    git status --short
    return 1
  fi
  git symbolic-ref --quiet HEAD >/dev/null || { printf 'Git sem branch ativa (detached HEAD).\n'; return 1; }
  git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null || {
    printf 'A branch não possui upstream configurado.\n'; return 1;
  }
  printf '\n[2/5] Buscando e aplicando atualizações...\n'
  git fetch --prune
  if [[ "$(git rev-list --count '@{upstream}..HEAD')" != 0 ]]; then
    printf 'Há commits locais que não estão no upstream. Resolva a divergência antes de iniciar.\n'
    return 1
  fi
  launcher_antes="$(git hash-object -- iniciar-worker.sh)"
  git pull --ff-only
  if [[ "$(git rev-parse HEAD)" != "$(git rev-parse '@{upstream}')" ]]; then
    printf 'O checkout não corresponde ao upstream após o pull.\n'
    return 1
  fi
  printf 'Versão do projeto: %s\n' "$(git rev-parse --short HEAD)"
  if [[ "$launcher_antes" != "$(git hash-object -- iniciar-worker.sh)" ]]; then
    printf 'O iniciador foi atualizado. Reiniciando a preparação com a nova versão...\n'
    exec 9>&-
    exec bash "$project_dir/iniciar-worker.sh"
  fi
  printf '\n[3/5] Limpando caches locais e recriando dependências...\n'
  # Somente diretórios regeneráveis desta instalação; preserva browser e evidências.
  for cache_dir in .next .cache .turbo; do
    if [[ -L "$cache_dir" ]]; then
      printf 'Cache %s é um link simbólico. Limpeza interrompida.\n' "$cache_dir"
      return 1
    fi
    if [[ -n "$(git ls-files -- "$cache_dir")" ]]; then
      printf 'Cache %s contém arquivos versionados. Limpeza interrompida.\n' "$cache_dir"
      return 1
    fi
    rm -rf -- "$project_dir/$cache_dir"
  done
  if [[ -f tsconfig.tsbuildinfo && ! -L tsconfig.tsbuildinfo ]] &&
      [[ -z "$(git ls-files -- tsconfig.tsbuildinfo)" ]]; then
    rm -- tsconfig.tsbuildinfo
  fi
  [[ -f package-lock.json ]] || { printf 'package-lock.json não encontrado.\n'; return 1; }
  npm cache verify
  # npm ci recria node_modules e executa postinstall (prisma generate).
  npm ci --include=dev
  printf '\n[4/5] Validando a instalação...\n'
  node --env-file="$worker_env" --import tsx --input-type=module -e '
    import sharp from "sharp";
    import { createRequire } from "node:module";
    const require = createRequire(import.meta.url);
    require.resolve("@prisma/client");
    await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).jpeg().toBuffer();
    const version = Number(process.versions.node.split(".")[0]);
    if (version < 22) throw new Error("Use Node.js 22 ou superior.");
    console.info("Dependências e processamento de imagens: OK.");
  '
# Não sobrescreve uma configuração existente, inclusive instalações personalizadas.
artifacts_configurada=false
while IFS= read -r linha || [[ -n "$linha" ]]; do
  if [[ "$linha" =~ ^[[:space:]]*(export[[:space:]]+)?AUTOMATIZACAO_BROWSER_ARTIFACTS_DIR[[:space:]]*= ]]; then
    artifacts_configurada=true
    break
  fi
done < "$worker_env"
if [[ "$artifacts_configurada" == false ]]; then
  artifacts_dir="$HOME/.local/share/meury-browser/artefatos"
  if [[ ! -d "$artifacts_dir" ]]; then
    printf 'Pasta de evidências padrão não encontrada: %s\n' "$artifacts_dir"
    printf 'Configure AUTOMATIZACAO_BROWSER_ARTIFACTS_DIR no worker.env com o output-dir do navegador.\n'
    exit 1
  fi
  printf '\nAUTOMATIZACAO_BROWSER_ARTIFACTS_DIR="%s"\n' "$artifacts_dir" >> "$worker_env"
  chmod 600 "$worker_env"
  printf 'Pasta de evidências configurada: %s\n' "$artifacts_dir"
fi
node --env-file="$worker_env" --input-type=module -e '
  import { access, constants } from "node:fs/promises";
  import { isAbsolute } from "node:path";
  const pasta = process.env.AUTOMATIZACAO_BROWSER_ARTIFACTS_DIR;
  if (!pasta || !isAbsolute(pasta)) throw new Error("Configure uma pasta absoluta em AUTOMATIZACAO_BROWSER_ARTIFACTS_DIR.");
  await access(pasta, constants.R_OK | constants.W_OK | constants.X_OK);
  console.info("Pasta de evidências acessível: OK.");
'
printf '\n[5/5] Iniciando o worker. Mantenha este terminal aberto. Para parar, pressione Ctrl+C.\n'
node --env-file="$worker_env" --import tsx scripts/automatizacao-worker.ts

}
preparar_e_iniciar
