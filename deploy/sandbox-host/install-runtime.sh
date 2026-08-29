#!/usr/bin/env bash
# Install the sandbox runtime — the node server that fronts a session (reverse proxy, token-gated
# tmux terminal, agent stream, /_oyren/control API, resource stats) — onto the droplet.
#
# The tree lands in /srv/oyren/runtime/<tree-hash> and /app is a symlink to it (runtime-lib.sh).
# That is what lets a LIVE droplet take a newer runtime: stage the new tree beside the old one, flip
# the link, restart the unit when the updater says so. The bake and `oyren update` run this same
# script; the hash is the runtime's version in the image manifest, so a tree that is already
# active is left alone and only the helpers and units are refreshed.
#
# Idempotent. Runs as root during the snapshot bake and, from the new tree, during a live update.
set -euo pipefail

APP_LINK="${APP_DIR:-/app}"
RUNTIME_ROOT="${RUNTIME_ROOT:-/srv/oyren/runtime}"
SANDBOX_USER="${SANDBOX_USER:-oyren}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_SRC="$(cd "$HERE/../../sandbox-runtime" && pwd)"
export APP_LINK SANDBOX_USER
export PNPM_HOME="${PNPM_HOME:-/usr/local/share/pnpm}"
export PATH="$PNPM_HOME:$PATH"
# Same 1GB-bake V8 ceiling problem as the agent installs — see install-agents.sh.
export NODE_OPTIONS="--max-old-space-size=3072${NODE_OPTIONS:+ $NODE_OPTIONS}"
source "$HERE/../lib/tree-hash.sh"
source "$HERE/runtime-lib.sh"
source "$HERE/runtime-helpers.sh"

# The runtime's identity: a hash of the server plus the launchers and units in this directory,
# computed the way the bake runner hashes a release, so `oyren update --check` can tell a changed
# runtime from an unchanged one.
HASH="$(cd "$HERE/../.." && tree_hash sandbox-runtime deploy/sandbox-host)"
DEST="$RUNTIME_ROOT/$HASH"

if [ "$(readlink "$APP_LINK" 2>/dev/null || true)" = "$DEST" ]; then
  echo "==> Runtime $HASH is already active at $DEST"
else
  echo "==> Runtime $HASH -> $DEST"
  SKILLS=""
  # A lean image's skills live in the runtime tree (install-lean.sh copies them in), so a new tree
  # has to carry them across or the Lean agent loses its skills on update.
  [ "$(image_family)" = "lean" ] && SKILLS="$HERE/../lean/skills"
  stage_runtime "$RUNTIME_SRC" "$DEST" "$SKILLS"
  activate_runtime "$DEST" "$APP_LINK"
fi

echo "==> Helper commands on PATH"
install_runtime_helpers "$APP_LINK"

echo "==> Session launchers + systemd units"
install_runtime_units "$HERE"
systemctl daemon-reload
# Enabled but inert: ConditionPathExists=/etc/oyren/sandbox.env means it no-ops during the bake and
# only starts once cloud-init writes that file on a real session droplet.
systemctl enable oyren-sandbox.service

# Keep the previous tree as the rollback target; anything older is dead weight on the disk.
prune_runtimes "$RUNTIME_ROOT" "$DEST"
"$HERE/../manifest/stamp.sh" runtime "$HASH"

echo "✅ sandbox runtime $HASH installed at ${APP_LINK} -> ${DEST}"
