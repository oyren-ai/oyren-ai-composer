#!/usr/bin/env bash
# Create the directory that session repos clone into, and publish its path to the baked env.
#
# It lives under the sandbox user's HOME rather than at the filesystem root. The browser editor runs
# as that same user, so everything it opens, watches and writes is owned by the process doing it —
# no chown dance at launch, and no root-owned files appearing inside a tree the editor then cannot
# write to.
#
# /workspace stays as a SYMLINK to it. Absolute /workspace paths are baked into skill docs, AGENTS.md
# files, agent habits and older snapshots; the symlink keeps every one of them resolving, so moving
# the directory is not a fleet-wide breakage.
#
# Idempotent: safe to re-run on a re-bake. Runs as root during the snapshot bake.
#
# Env:
#   SANDBOX_USER          unix user that owns the tree (default: oyren)
#   OYREN_WORKSPACE_DIR   override the location (default: <user home>/workspace)
set -euo pipefail

SANDBOX_USER="${SANDBOX_USER:-oyren}"
SANDBOX_HOME="$(getent passwd "$SANDBOX_USER" | cut -d: -f6)"
if [ -z "$SANDBOX_HOME" ]; then
  echo "ERROR: user '$SANDBOX_USER' has no home directory" >&2
  exit 1
fi
WORKSPACE_DIR="${OYREN_WORKSPACE_DIR:-$SANDBOX_HOME/workspace}"

mkdir -p "$WORKSPACE_DIR"
chown -R "$SANDBOX_USER:$SANDBOX_USER" "$WORKSPACE_DIR"

# Never clobber a real directory: on a droplet booted from a pre-move snapshot /workspace holds the
# actual clones, and replacing it with a symlink would strand them.
if [ ! -e /workspace ] || [ -L /workspace ]; then
  ln -sfn "$WORKSPACE_DIR" /workspace
else
  echo "    WARNING: /workspace exists and is not a symlink — leaving it alone" >&2
fi

# One value, read by the systemd units, the editor launcher and the session runtime alike.
if [ -f /etc/oyren/host.env ]; then
  sed -i '/^OYREN_WORKSPACE_DIR=/d' /etc/oyren/host.env
  echo "OYREN_WORKSPACE_DIR=${WORKSPACE_DIR}" >> /etc/oyren/host.env
fi

echo "==> workspace at $WORKSPACE_DIR (/workspace -> $WORKSPACE_DIR)"
