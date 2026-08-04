#!/usr/bin/env bash
# Add Lean 4 + Mathlib to a sandbox droplet, producing the SECOND snapshot variant.
#
# This is NOT part of the base bake. Mathlib costs 3-5GB and only the Lean app needs it, so paying
# it on every launch is waste. Instead: bake the base snapshot once, boot one droplet from it, run
# this, and re-snapshot. The two snapshots then differ by exactly this script, and the orchestrator
# picks between them by runtime kind.
#
# Everything else the Lean app needs — the editor, the agent CLIs, the runtime — is already in the
# base snapshot, which is why deriving is cheap.
#
# Idempotent: safe to re-run. Runs as root on a droplet booted from the base snapshot.
set -euo pipefail

SANDBOX_USER="${SANDBOX_USER:-oyren}"
LEAN_DIR="${LEAN_DIR:-/workspace/lean}"
EDITOR_DIR="${EDITOR_DIR:-/opt/openvscode-server}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_HOME="$(getent passwd "$SANDBOX_USER" | cut -d: -f6)"

echo "==> Lean project template -> ${LEAN_DIR}"
mkdir -p "$LEAN_DIR"
cp -a "$HERE/template/." "$LEAN_DIR"/
# Lean skills merge with the base image's /app/skills and are seeded into the agent's skills dir
# at launch, same as every other app's.
mkdir -p /app/skills
cp -a "$HERE/skills/." /app/skills/
chown -R "$SANDBOX_USER:$SANDBOX_USER" "$LEAN_DIR" /app/skills

# elan pins the toolchain from template/lean-toolchain. Mathlib in lakefile.toml is pinned to the
# SAME tag on purpose — bump both together, or `lake exe cache get` finds no prebuilt oleans and
# the build compiles Mathlib from source for hours instead of minutes.
echo "==> elan + toolchain $(cat "$LEAN_DIR/lean-toolchain")"
su - "$SANDBOX_USER" -c "curl -sSf https://elan.lean-lang.org/elan-init.sh \
  | sh -s -- -y --default-toolchain '$(cat "$LEAN_DIR/lean-toolchain")'"

# cache get pulls prebuilt oleans; lake build then warms everything so the FIRST launch already has
# a working language server instead of compiling on the user's first keystroke. The download cache
# is removed afterwards — only the unpacked oleans are what the server and lake actually use, and
# re-running `cache get` on a live droplet would just download it again.
echo "==> Mathlib (cache get + build; several minutes)"
su - "$SANDBOX_USER" -c "cd '$LEAN_DIR' && \
  export PATH=\"\$HOME/.elan/bin:\$PATH\" && \
  lake exe cache get && lake build && rm -rf \"\$HOME/.cache/mathlib\""

echo "==> vscode-lean4 extension (Open VSX — the infoview / goal state UI)"
su - "$SANDBOX_USER" -c "'$EDITOR_DIR/bin/openvscode-server' --install-extension leanprover.lean4"

# The editor and the agent both start in the Lean project when no repo is cloned.
cat > /etc/profile.d/30-oyren-lean.sh <<EOF
export ELAN_HOME="${USER_HOME}/.elan"
export PATH="\$ELAN_HOME/bin:\$PATH"
EOF
chmod 0644 /etc/profile.d/30-oyren-lean.sh

echo "✅ Lean + Mathlib installed — snapshot this droplet as the lean variant"