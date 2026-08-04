#!/usr/bin/env bash
# Composer install step for the VM image bakes (run as root on a fresh Ubuntu 24.04 host
# by the image bake scripts, AFTER Docker CE is installed —
# Docker install is the caller's job, not this script's).
# Installs Node 24, puts this repo at /srv/composer/app (uses an existing checkout if the
# caller already placed one), builds dist/, and installs + enables all three run-mode
# systemd units. Each unit is a no-op until its /etc/oyren/*.env exists (ConditionPathExists),
# so enabling all of them in every snapshot is safe — cloud-init picks the mode by writing
# exactly one env file.
# Usage: COMPOSER_GIT_URL=... COMPOSER_GIT_REF=... ./bake-install.sh
set -euo pipefail

APP_DIR="/srv/composer/app"
GIT_URL="${COMPOSER_GIT_URL:-https://github.com/oyren-ai/oyren-ai-composer.git}"
GIT_REF="${COMPOSER_GIT_REF:-main}"

echo "==> Node 24 (NodeSource)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

echo "==> Composer checkout at $APP_DIR"
# package.json, not .git, marks an existing checkout: pre-placed trees are rsynced without
# their .git directory on purpose.
if [ ! -e "$APP_DIR/package.json" ]; then
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --depth 1 --branch "$GIT_REF" "$GIT_URL" "$APP_DIR"
fi

echo "==> Build"
cd "$APP_DIR"
npm ci
npm run build

# Everything the SANDBOX lane needs on the VM itself, because agents now run on the droplet rather
# than inside a container: the host packages + oyren user, every agent CLI, and the branded editor.
# Order matters — install-host.sh creates the user and pnpm that the other two rely on, and all
# three need the Node install above.
# The edge and build lanes want none of it (an edge host is a 1GB Caddy box), so SANDBOX_HOST=0
# skips the lot and keeps those bakes small and fast.
if [ "${SANDBOX_HOST:-1}" = "1" ]; then
  bash "$APP_DIR/deploy/sandbox-host/install-host.sh"
  bash "$APP_DIR/deploy/sandbox-host/install-agents.sh"
  bash "$APP_DIR/deploy/editor/install-editor.sh"
fi

echo "==> systemd units (enabled; inert until cloud-init writes their env file)"
cp "$APP_DIR"/deploy/units/oyren-sandbox.service \
   "$APP_DIR"/deploy/units/oyren-build.service \
   "$APP_DIR"/deploy/units/oyren-edge.service \
   /etc/systemd/system/
mkdir -p /etc/oyren
systemctl daemon-reload
systemctl enable oyren-sandbox.service oyren-build.service oyren-edge.service

echo "✅ composer installed (units enabled, awaiting /etc/oyren/*.env from cloud-init)"
