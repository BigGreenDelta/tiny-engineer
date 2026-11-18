#!/usr/bin/env bash
# Copy the broker into the Home Assistant add-on folder (ha-addon/tiny-engineer-broker/app).
# Then copy ha-addon/tiny-engineer-broker into the HA /addons share.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/packages/tiny-engineer-broker"
dst="$root/ha-addon/tiny-engineer-broker/app"
rm -rf "$dst"
mkdir -p "$dst"
cp -r "$src/bin" "$src/src" "$src/package.json" "$dst/"
echo "synced $src -> $dst"
