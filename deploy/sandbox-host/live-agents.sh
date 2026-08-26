#!/usr/bin/env bash
# Apply one or more agent components to a LIVE droplet, the way an in-place update does:
#
#   live-agents.sh claude dsh            re-install exactly those at the pins in deploy/versions.env
#   live-agents.sh --force cursor        vendor installers have no pin and are never touched unless forced
#
# Each component is installed with the same function the bake uses (agents/*.sh) and stamped into
# the image manifest as it lands, so a run that dies half-way leaves a manifest that says which
# parts moved. Exit 2 = unknown component, 3 = refused (a vendor install without --force).
# Runs as root, from the tree the release was extracted to.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../lib/versions.sh"
load_versions
STAMP="$HERE/../manifest/stamp.sh"

SANDBOX_USER="${SANDBOX_USER:-oyren}"
DSH_DIR="${DSH_DIR:-/opt/oyren-dsh}"
export SANDBOX_USER
export PNPM_HOME="${PNPM_HOME:-/usr/local/share/pnpm}"
export PATH="$PNPM_HOME:$PATH"
export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
export NODE_OPTIONS="--max-old-space-size=3072${NODE_OPTIONS:+ $NODE_OPTIONS}"

source "$HERE/agents/pnpm-clis.sh"
source "$HERE/agents/dsh.sh"
source "$HERE/agents/vendor.sh"
source "$HERE/agents/playwright.sh"
source "$HERE/agents/profile.sh"

FORCE=0
COMPONENTS=()
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --*) echo "ERROR: unknown option: $arg" >&2; exit 2 ;;
    *) COMPONENTS+=("$arg") ;;
  esac
done
[ "${#COMPONENTS[@]}" -gt 0 ] || { echo "usage: live-agents.sh [--force] <component>…" >&2; exit 2; }

for c in "${COMPONENTS[@]}"; do
  case "$c" in
    claude|codex|codexAcp|gemini|opencode|qwen|antigravityAcp)
      echo "==> $c $(agent_version_of "$c")"
      agent_pnpm_one "$c"
      [ "$c" = "claude" ] && claude_smoke
      "$STAMP" "$c" "$(agent_version_of "$c")" ;;
    dsh) install_dsh "$DSH_VERSION" "$DSH_DIR"; "$STAMP" dsh "$DSH_VERSION" ;;
    bun) install_bun "$BUN_VERSION"; "$STAMP" bun "$BUN_VERSION" ;;
    playwrightMcp) install_playwright_mcp "$PLAYWRIGHT_MCP_VERSION"; "$STAMP" playwrightMcp "$PLAYWRIGHT_MCP_VERSION" ;;
    profile) write_agents_profile ;;
    cursor|agy)
      if [ "$FORCE" != 1 ]; then
        echo "refusing to reinstall $c: it has no pinned version, so an update cannot know what it would change. Pass --force to take the vendor's current build." >&2
        exit 3
      fi
      if [ "$c" = "cursor" ]; then install_cursor; else install_agy; fi ;;
    *) echo "ERROR: unknown agent component: $c" >&2; exit 2 ;;
  esac
done

rm -rf "/home/$SANDBOX_USER/.npm"
chown -R "$SANDBOX_USER:$SANDBOX_USER" "$PNPM_HOME"
echo "✅ live agent update applied: ${COMPONENTS[*]}"
