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
command -v flock >/dev/null 2>&1 || { printf 'flock não encontrado (pacote util-linux).\n'; exit 1; }
cd -- "$project_dir"
# Impede duas instâncias iniciadas por este arquivo para o mesmo usuário.
exec 9>"$HOME/.config/meury-worker/iniciar-worker.lock"
if ! flock -n 9; then
  printf 'Já existe um worker iniciado por este arquivo. Use o terminal que está aberto.\n'
  exit 1
fi
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
printf 'Iniciando o worker. Mantenha este terminal aberto. Para parar, pressione Ctrl+C.\n' 
node --env-file="$worker_env" --import tsx scripts/automatizacao-worker.ts
