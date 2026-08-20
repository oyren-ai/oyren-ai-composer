#!/usr/bin/env bash
# Install every coding-agent CLI onto the sandbox droplet.
#
# One snapshot carries all of them, so a launch picks its agent purely at runtime via AGENT_KIND —
# which the sandbox entrypoint already reads. That is what retires the old per-(agent,format) image
# matrix: 7 agents x 4 formats was 28 images to build and push, now it is one snapshot re-baked by
# hand when a version should move.
#
# Versions are PINNED, exactly as the per-agent Dockerfiles pinned them. Agent CLIs ship breaking
# changes often and a floating tag turns a re-bake into a silent upgrade of every future sandbox.
# Bump deliberately, one at a time, and re-bake.
#
# Idempotent: safe to re-run. Runs as root during the snapshot bake.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

CLAUDE_VERSION="${CLAUDE_VERSION:-2.1.235}"
CODEX_VERSION="${CODEX_VERSION:-0.142.0}"
CODEX_ACP_VERSION="${CODEX_ACP_VERSION:-1.1.2}"
GEMINI_VERSION="${GEMINI_VERSION:-0.50.0}"
OPENCODE_VERSION="${OPENCODE_VERSION:-1.17.18}"
QWEN_VERSION="${QWEN_VERSION:-0.19.9}"
ANTIGRAVITY_ACP_VERSION="${ANTIGRAVITY_ACP_VERSION:-1.0.0}"
PLAYWRIGHT_MCP_VERSION="${PLAYWRIGHT_MCP_VERSION:-0.0.78}"
BUN_VERSION="${BUN_VERSION:-bun-v1.3.14}"

SANDBOX_USER="${SANDBOX_USER:-oyren}"
export PNPM_HOME="${PNPM_HOME:-/usr/local/share/pnpm}"
export PATH="$PNPM_HOME:$PATH"
export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# The bake runs on a 1GB droplet — its 25GB disk is what caps the minimum session droplet size, so
# it cannot simply be given more RAM. V8 sizes its default heap from physical memory and lands at
# ~490MB there, which installing claude-code alone exceeds; the first bake died exactly there.
# The 4GB swapfile does NOT help on its own: max-old-space-size is a hard V8 ceiling enforced
# regardless of available memory. Raise the ceiling and let swap absorb anything past physical RAM.
export NODE_OPTIONS="--max-old-space-size=3072${NODE_OPTIONS:+ $NODE_OPTIONS}"

# HOME=/root keeps pnpm's store and logs out of the sandbox user's home, where they would otherwise
# land root-owned and break the agent's first write.
pg() { HOME=/root pnpm add -g --allow-build="$1" "$1@$2"; }

echo "==> claude ${CLAUDE_VERSION}"
pg @anthropic-ai/claude-code "$CLAUDE_VERSION"
# `claude` is a 500-byte SHIM until the package's postinstall links the platform-native binary
# (@anthropic-ai/claude-code-linux-x64) into bin/. Without --allow-build above pnpm skips that
# script and the shim survives the bake, so every session gets a `claude` that only prints
# "claude native binary not installed" — which is exactly how it reached a live sandbox once.
# Run it, don't just look for the file: only executing proves the native binary is really there.
CLAUDE_SMOKE="$(HOME=/root timeout 60 claude --version 2>&1 || true)"
case "$CLAUDE_SMOKE" in
  *"$CLAUDE_VERSION"*) echo "    claude smoke: $CLAUDE_SMOKE" ;;
  *) echo "ERROR: claude does not run after install (native binary not linked?): $CLAUDE_SMOKE" >&2; exit 1 ;;
esac

echo "==> codex ${CODEX_VERSION} (+ acp ${CODEX_ACP_VERSION})"
pg @openai/codex "$CODEX_VERSION"
pg @agentclientprotocol/codex-acp "$CODEX_ACP_VERSION"

echo "==> gemini ${GEMINI_VERSION}"
pg @google/gemini-cli "$GEMINI_VERSION"

echo "==> opencode ${OPENCODE_VERSION}"
pg opencode-ai "$OPENCODE_VERSION"

echo "==> qwen ${QWEN_VERSION}"
pg @qwen-code/qwen-code "$QWEN_VERSION"

echo "==> cursor (vendor installer — no pinned version available)"
su - "$SANDBOX_USER" -c 'curl https://cursor.com/install -fsS | bash'
ln -sf "/home/$SANDBOX_USER/.local/bin/agent" /usr/local/bin/agent
ln -sf "/home/$SANDBOX_USER/.local/bin/cursor-agent" /usr/local/bin/cursor-agent

echo "==> antigravity (+ bun ${BUN_VERSION}, its acp shim needs it)"
curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- --dir /usr/local/bin
# The installer ignores --dir and drops the binary in $HOME/.local/bin — which is /root here, a
# directory the sandbox user cannot read. In the container this was masked because the install ran
# as `oyren`; on the VM it runs as root, so AGY_BIN would point at a path the agent can't execute.
if [ ! -x /usr/local/bin/agy ]; then
  AGY_SRC="$(command -v agy || true)"
  [ -n "$AGY_SRC" ] || AGY_SRC=/root/.local/bin/agy
  if [ -x "$AGY_SRC" ]; then
    install -m 0755 "$AGY_SRC" /usr/local/bin/agy
    echo "    relocated agy from $AGY_SRC"
  else
    echo "    WARNING: agy binary not found — antigravity launches will fail" >&2
  fi
fi
apt-get -o DPkg::Lock::Timeout=300 install -y -qq --no-install-recommends unzip
curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s -- "$BUN_VERSION"
apt-get -y -qq purge unzip && apt-get -y -qq autoremove
HOME=/root pnpm add -g "antigravity-acp@${ANTIGRAVITY_ACP_VERSION}"

# Chromium for claude's playwright MCP. Shared, world-readable, outside any home dir so every agent
# reuses one copy instead of downloading ~150MB on first use.
echo "==> playwright MCP ${PLAYWRIGHT_MCP_VERSION} + chromium"
HOME=/root npm install -g "@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}"
# The Dockerfile hardcoded /usr/local/lib/node_modules/@playwright/mcp/node_modules/playwright-core/
# cli.js. TWO assumptions in that path break on a VM, and each killed a bake:
#   1. the prefix — node:24 images use /usr/local, but NodeSource Ubuntu installs globals under
#      /usr, so the directory did not exist at all;
#   2. the nesting — npm hoists playwright-core to the global root here rather than nesting it
#      under the mcp package.
# So resolve both dynamically: ask npm for its global root, then ask node where the mcp package
# would actually load playwright-core from, with a search as the last resort.
NPM_ROOT="$(npm root -g)"
PW_MCP_DIR="$NPM_ROOT/@playwright/mcp"
PW_CORE="$(node -e "console.log(require.resolve('playwright-core/cli.js',{paths:['$PW_MCP_DIR']}))" 2>/dev/null || true)"
[ -n "$PW_CORE" ] || PW_CORE="$(find "$NPM_ROOT" -path '*playwright-core/cli.js' -print -quit 2>/dev/null || true)"
[ -n "$PW_CORE" ] || { echo "ERROR: playwright-core cli.js not found after install" >&2; exit 1; }
echo "    playwright-core cli: $PW_CORE"
apt-get -o DPkg::Lock::Timeout=300 update -qq
HOME=/root node "$PW_CORE" install-deps chromium
HOME=/root node "$PW_CORE" install --no-shell chromium
chmod -R a+rX "$PLAYWRIGHT_BROWSERS_PATH"

# Agent-specific runtime env, applied to interactive shells and services alike.
cat > /etc/profile.d/20-oyren-agents.sh <<'EOF'
export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
export AGY_BIN=/usr/local/bin/agy
# Claude Code renders for a real TTY by default; the sandbox drives it headlessly over a pipe.
export CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1
export CLAUDE_CODE_DISABLE_MOUSE=1
# The pinned claude is installed by root (this script IS the update channel — bump + re-bake), so
# its self-updater cannot write its own prefix and every session footer shows
# "Auto-update failed: no write permission to npm prefix · Run claude doctor".
# seedClaudeSettings.js already puts this in ~/.claude/settings.json env, which is what covers the
# non-login spawns (the editor extension, systemd units); this line covers the LOGIN shells that
# file cannot be trusted for — a user's own settings.json write can drop it, and a session booted
# from a snapshot older than that seeder never had it at all.
export DISABLE_AUTOUPDATER=1
export IS_SANDBOX=1
EOF
chmod 0644 /etc/profile.d/20-oyren-agents.sh

rm -rf /var/lib/apt/lists/* "/home/$SANDBOX_USER/.npm"
install -d -o "$SANDBOX_USER" -g "$SANDBOX_USER" "/home/$SANDBOX_USER/.cache"
chown -R "$SANDBOX_USER:$SANDBOX_USER" "$PNPM_HOME"

echo "✅ agent CLIs installed (claude codex gemini cursor opencode qwen antigravity)"