#!/usr/bin/env bash
# Deploy the Tiny Engineer Broker to a Windows host that runs rootful podman
# in WSL (docs/broker.md): copy the package over WinRM, build the image,
# install the Quadlet, restart, forward the port, check /health.
#
# Settings come from the environment, or from scripts/deploy-broker.local.env
# (git-ignored), e.g.:
#   DEPLOY_WINRM_URL=http://192.168.1.10:5985/wsman
#   DEPLOY_WINRM_USER_REF=op://vault/item/username   # or DEPLOY_WINRM_USER=...
#   DEPLOY_WINRM_PASS_REF=op://vault/item/password   # or DEPLOY_WINRM_PASS=...
#   DEPLOY_WSL_DISTRO=Debian
#   DEPLOY_ROBOT_URL=http://192.168.1.20               # optional: written to the env file
#   DEPLOY_ROBOT_TOKEN_REF=op://vault/robot/password   # optional: written to the env file
set -euo pipefail

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
WINRM_USER="$(secret "${DEPLOY_WINRM_USER:-}" "${DEPLOY_WINRM_USER_REF:-}")"
WINRM_PASS="$(secret "${DEPLOY_WINRM_PASS:-}" "${DEPLOY_WINRM_PASS_REF:-}")"
robot_token="$(secret "${DEPLOY_ROBOT_TOKEN:-}" "${DEPLOY_ROBOT_TOKEN_REF:-}")"
: "${WINRM_USER:?no WinRM user}" "${WINRM_PASS:?no WinRM password}"
export WINRM_URL="$DEPLOY_WINRM_URL" WINRM_USER WINRM_PASS

winrm() { uv run --no-project --quiet --with pywinrm python "$root/scripts/winrm_cli.py" "$@"; }

pkg="$root/packages/tiny-engineer-broker"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
tar czf "$work/broker.tgz" -C "$pkg" package.json Dockerfile bin src deploy

echo "== upload"
remote_tgz='C:\Windows\Temp\tiny-engineer-broker.tgz'
winrm upload "$work/broker.tgz" "$remote_tgz"

echo "== build + restart (WSL $distro, root)"
{
  echo "set -euo pipefail"
  echo "robot_url=$(printf '%q' "${DEPLOY_ROBOT_URL:-}")"
  echo "robot_token=$(printf '%q' "$robot_token")"
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
install -m 644 deploy/tiny-engineer-broker.container /etc/containers/systemd/
systemctl daemon-reload
systemctl restart tiny-engineer-broker.service
sleep 3
systemctl is-active tiny-engineer-broker.service
curl -fsS localhost:8790/health; echo
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
