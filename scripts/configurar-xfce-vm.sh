#!/usr/bin/env bash
# Execute no terminal gráfico do XFCE, como operador, sem sudo.
set -euo pipefail
umask 077

fail() { printf 'Erro: %s\n' "$*" >&2; exit 1; }
[[ $(uname -s) == Linux ]] || fail 'Este script é exclusivo para Linux com XFCE.'
[[ $EUID -ne 0 ]] || fail 'Execute como operador, sem sudo/root.'
[[ -n ${DISPLAY:-} && -n ${DBUS_SESSION_BUS_ADDRESS:-} ]] ||
  fail 'Abra um terminal dentro da sessão XFCE e execute novamente.'
for cmd in xfconf-query xset pkill; do
  command -v "$cmd" >/dev/null || fail "Comando necessário ausente: $cmd"
done
xset q >/dev/null || fail 'Não foi possível acessar a tela desta sessão.'
xfconf-query -c xfce4-power-manager -l >/dev/null || fail 'Não foi possível acessar o Xfconf.'

config=${XDG_CONFIG_HOME:-$HOME/.config}
backup=$(mktemp -d "$HOME/meury-xfce-backup.XXXXXXXX")
autostart="$config/autostart/light-locker.desktop"
mkdir -p "$config/autostart"
if [[ -e $autostart ]]; then
  cp "$autostart" "$backup/light-locker.desktop"
else
  touch "$backup/light-locker-ausente"
fi
xset q > "$backup/tela-antes.txt"
printf '#!/usr/bin/env bash\nset -euo pipefail\n' > "$backup/restaurar.sh"
printf 'destino=%q\nbackup=%q\n' "$autostart" "$backup" >> "$backup/restaurar.sh"
cat >> "$backup/restaurar.sh" <<'RESTORE'
if [[ -f "$backup/light-locker-ausente" ]]; then
  rm -f -- "$destino"
else
  cp "$backup/light-locker.desktop" "$destino"
fi
RESTORE

set_property() {
  local name=$1 type=$2 desired=$3 previous prop="/xfce4-power-manager/$1"
  if previous=$(xfconf-query -c xfce4-power-manager -p "$prop" 2>/dev/null); then
    printf 'xfconf-query -c xfce4-power-manager -p %q -s %q\n' "$prop" "$previous" >> "$backup/restaurar.sh"
    xfconf-query -c xfce4-power-manager -p "$prop" -s "$desired"
  else
    printf 'xfconf-query -c xfce4-power-manager -p %q -r\n' "$prop" >> "$backup/restaurar.sh"
    xfconf-query -c xfce4-power-manager -p "$prop" -n -t "$type" -s "$desired"
  fi
  [[ $(xfconf-query -c xfce4-power-manager -p "$prop") == "$desired" ]] || fail "Não foi possível verificar $name. Backup: $backup"
}

printf 'A sessão ficará sem bloqueio automático; proteja o acesso ao VNC.\n'
printf 'Backup e restauração: %s\n' "$backup"
# No XFCE 4.18, 14 é o valor sentinela para nunca suspender por inatividade.
set_property inactivity-on-ac uint 14
set_property inactivity-on-battery uint 14
set_property blank-on-ac int 0
set_property blank-on-battery int 0
set_property dpms-enabled bool false
set_property dpms-on-ac-sleep uint 0
set_property dpms-on-ac-off uint 0
set_property dpms-on-battery-sleep uint 0
set_property dpms-on-battery-off uint 0

# Uma entrada mínima substitui o autostart do sistema somente para este usuário.
cat > "$autostart" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Light Locker
Hidden=true
DESKTOP
xset s off
xset s noblank
xset -dpms
if pkill -u "$(id -u)" -x light-locker; then
  printf 'Light Locker encerrado para este usuário.\n'
else
  status=$?
  [[ $status -eq 1 ]] || fail "Falha ao encerrar Light Locker. Backup: $backup"
fi
printf 'Concluído: suspensão por inatividade e apagamento desativados; Light Locker sem autostart.\n'
printf 'Senha, LightDM, browser e worker não foram alterados nem reiniciados.\n'
printf 'Para desfazer: bash %q/restaurar.sh e depois entre novamente na sessão.\n' "$backup"
