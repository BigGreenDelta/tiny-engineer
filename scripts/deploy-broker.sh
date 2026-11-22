#!/usr/bin/env bash
# Deploy the Tiny Engineer Broker to a Windows host that runs rootful podman
# in WSL (docs/broker.md): copy the package over WinRM, build the image,
# install the Quadlet, restart, forward the port, check /health.
#
#   bash scripts/deploy-broker.sh             # deploy and (re)start the broker
#   bash scripts/deploy-broker.sh --no-start  # deploy; a stopped broker stays stopped
#
# Settings come from the environment, or from scripts/deploy-broker.local.env
# (git-ignored), e.g.:
#   DEPLOY_WINRM_URL=https://192.168.1.10:5986/wsman
#   DEPLOY_WINRM_CERT_ITEM=op://vault/item            # certificate login, no password (see scripts/winrm_cli.py)
#   # or NTLM with a password:
#   DEPLOY_WINRM_URL=http://192.168.1.10:5985/wsman
#   DEPLOY_WINRM_USER_REF=op://vault/item/username   # or DEPLOY_WINRM_USER=...
#   DEPLOY_WINRM_PASS_REF=op://vault/item/password   # or DEPLOY_WINRM_PASS=...
#   DEPLOY_WSL_DISTRO=Debian
#   DEPLOY_ROBOT_URL=http://192.168.1.20               # optional: written to the env file
#   DEPLOY_ROBOT_TOKEN_REF=op://vault/robot/password   # optional: written to the env file
#   DEPLOY_BROKER_TOKEN_REF=op://vault/broker/password # optional: TE_BROKER_TOKEN, guards pause/resume
set -euo pipefail

start=1
case "${1:-}" in
  "") ;;
  --no-start) start=0 ;;
  *) echo "usage: $0 [--no-start]" >&2; exit 2 ;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"
local_env="$root/scripts/deploy-broker.local.env"
# shellcheck disable=SC1090
[ -f "$local_env" ] && . "$local_env"

: "${DEPLOY_WINRM_URL:?set DEPLOY_WINRM_URL (see the header of this script)}"
distro="${DEPLOY_WSL_DISTRO:-Debian}"

secret() { # value, or `op read` of a reference
  local value="$1" ref="$2"
  if [ -n "$value" ]; then printf '%s' "$value"; elif [ -n "$ref" ]; then op read "$ref"; fi
}
robot_token="$(secret "${DEPLOY_ROBOT_TOKEN:-}" "${DEPLOY_ROBOT_TOKEN_REF:-}")"
broker_token="$(secret "${DEPLOY_BROKER_TOKEN:-}" "${DEPLOY_BROKER_TOKEN_REF:-}")"
export WINRM_URL="$DEPLOY_WINRM_URL"
if [ -n "${DEPLOY_WINRM_CERT_ITEM:-}" ]; then
  export WINRM_CERT_OP_ITEM="$DEPLOY_WINRM_CERT_ITEM"
else
  WINRM_USER="$(secret "${DEPLOY_WINRM_USER:-}" "${DEPLOY_WINRM_USER_REF:-}")"
  WINRM_PASS="$(secret "${DEPLOY_WINRM_PASS:-}" "${DEPLOY_WINRM_PASS_REF:-}")"
  : "${WINRM_USER:?no WinRM user}" "${WINRM_PASS:?no WinRM password}"
  export WINRM_USER WINRM_PASS
fi

winrm() { uv run --no-project --quiet --with pywinrm python -I "$root/scripts/winrm_cli.py" "$@"; }

pkg="$root/packages/tiny-engineer-broker"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
tar czf "$work/broker.tgz" -C "$pkg" package.json Dockerfile bin src deploy

echo "== upload"
remote_tgz='C:\Windows\Temp\tiny-engineer-broker.tgz'
winrm upload "$work/broker.tgz" "$remote_tgz"

echo "== build + install (WSL $distro, root)"
{
  echo "set -euo pipefail"
  echo "start=$start"
  echo "robot_url=$(printf '%q' "${DEPLOY_ROBOT_URL:-}")"
  echo "robot_token=$(printf '%q' "$robot_token")"
  echo "broker_token=$(printf '%q' "$broker_token")"
  cat <<'WSL'
src=/opt/tiny-engineer-broker
mkdir -p "$src" && cd "$src"
rm -rf bin src deploy
tar xzf "$(wslpath -u 'C:\Windows\Temp\tiny-engineer-broker.tgz')"
podman build -q -t localhost/tiny-engineer-broker:latest . >/dev/null
env=/etc/tiny-engineer-broker.env
umask 077
touch "$env"
set_var() { # keep other lines, replace this one
  grep -v "^$1=" "$env" > "$env.new" || true
  printf '%s=%s\n' "$1" "$2" >> "$env.new"
  mv "$env.new" "$env"
}
[ -n "$robot_url" ] && set_var TE_ROBOT_URL "$robot_url"
[ -n "$robot_token" ] && set_var TE_ROBOT_TOKEN "$robot_token"
[ -n "$broker_token" ] && set_var TE_BROKER_TOKEN "$broker_token"
unit=tiny-engineer-broker.service
active="$(systemctl is-active "$unit" || true)"
install -m 644 deploy/tiny-engineer-broker.container /etc/containers/systemd/
systemctl daemon-reload
if [ "$start" = 1 ] || [ "$active" = active ]; then
  systemctl restart "$unit"
  sleep 3
  systemctl is-active "$unit"
  curl -fsS localhost:8790/health; echo
else
  echo "$unit was $active: left stopped (--no-start)"
fi
WSL
} | winrm wsl "$distro" root

echo "== port forward 8790 -> WSL"
winrm ps <<PS
\$ProgressPreference = "SilentlyContinue"
\$ip = (wsl -d '$distro' -- hostname -I).Trim().Split(' ') |
  Where-Object { \$_ -match '^\d+\.' -and \$_ -notmatch '^172\.(1[6-9]|2\d|3[01])\.' } |
  Select-Object -First 1
netsh interface portproxy delete v4tov4 listenport=8790 listenaddress=0.0.0.0 2>\$null | Out-Null
netsh interface portproxy add v4tov4 listenport=8790 listenaddress=0.0.0.0 connectport=8790 connectaddress=\$ip | Out-Null
if (-not (Get-NetFirewallRule -DisplayName 'Tiny Engineer broker 8790' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'Tiny Engineer broker 8790' -Direction Inbound -Protocol TCP -LocalPort 8790 -RemoteAddress LocalSubnet -Action Allow | Out-Null
}
"8790 -> \$ip"
PS
echo "== done"
