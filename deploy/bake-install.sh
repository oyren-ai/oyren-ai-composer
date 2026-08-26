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
# Stamped into the image manifest at the end (deploy/manifest/write-manifest.sh). The bake scripts
# pass the real values over ssh; a by-hand run gets a fresh UTC stamp and "unknown".
RELEASE_VERSION="${RELEASE_VERSION:-$(date -u +%Y-%m-%d-%H%M)}"
RELEASE_FAMILY="${RELEASE_FAMILY:-base}"
COMPOSER_SHA="${COMPOSER_SHA:-unknown}"

# A freshly booted droplet is still running cloud-init's own apt for a minute or two; starting
# into that race kills the bake on its first apt call (see wait-for-apt.sh for the post-mortem).
bash "$(dirname "${BASH_SOURCE[0]}")/wait-for-apt.sh"

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
  bash "$APP_DIR/deploy/sandbox-host/install-runtime.sh"
  bash "$APP_DIR/deploy/editor/install-editor.sh"
  # Streamed Zed, in the SAME image as the browser editor. It used to be a derived variant, but a
  # session can now switch between the two surfaces while it runs (editorSurface.js), which needs
  # both present. It costs nothing that matters: ~1.5GB inside the base's ~13.5GB headroom, on the
  # same 25GB s-1vcpu-1gb bake droplet, so the image's droplet floor is unchanged — and one image
  # instead of two ends the drift where a fix landed in the base and the zed variant lagged a
  # derive behind. Zed stays xl+ gated at RUNTIME by the orchestrator, where CPU is knowable.
  bash "$APP_DIR/deploy/zed/install-zed.sh"
  # The in-VM browser rides the SAME KasmVNC/openbox stack the line above installs, and its Chrome
  # is the one install-agents.sh already put under /ms-playwright — so it adds a launcher, a unit
  # and a $BROWSER hook, and nothing else to the image. It exists because an agent CLI's OAuth
  # callback is a LOOPBACK url: only a browser ON this machine can complete a codex/claude login.
  bash "$APP_DIR/deploy/browser/install-browser.sh"
fi

echo "==> systemd units (enabled; inert until cloud-init writes their env file)"
cp "$APP_DIR"/deploy/units/oyren-sandbox.service \
   "$APP_DIR"/deploy/units/oyren-build.service \
   "$APP_DIR"/deploy/units/oyren-edge.service \
   /etc/systemd/system/
mkdir -p /etc/oyren
systemctl daemon-reload
systemctl enable oyren-sandbox.service oyren-build.service oyren-edge.service

# The image manifest, LAST. Each installer above stamped its own component as it finished; this
# writes the whole thing from deploy/versions.env plus the tree hashes, under the bake's version.
if [ "${SANDBOX_HOST:-1}" = "1" ]; then
  echo "==> image manifest ($RELEASE_FAMILY $RELEASE_VERSION)"
  bash "$APP_DIR/deploy/manifest/write-manifest.sh" --version "$RELEASE_VERSION" --family "$RELEASE_FAMILY" \
    --composer-sha "$COMPOSER_SHA" --root "$APP_DIR"
fi

echo "✅ composer installed (units enabled, awaiting /etc/oyren/*.env from cloud-init)"
