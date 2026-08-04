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

CLAUDE_VERSION="${CLAUDE_VERSION:-2.1.191}"
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

# HOME=/root keeps pnpm's store and logs out of the sandbox user's home, where they would otherwise
# land root-owned and break the agent's first write.
pg() { HOME=/root pnpm add -g --allow-build="$1" "$1@$2"; }

echo "==> claude ${CLAUDE_VERSION}"
pg @anthropic-ai/claude-code "$CLAUDE_VERSION"

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
apt-get -o DPkg::Lock::Timeout=300 install -y -qq --no-install-recommends unzip
curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s -- "$BUN_VERSION"
apt-get -y -qq purge unzip && apt-get -y -qq autoremove
HOME=/root pnpm add -g "antigravity-acp@${ANTIGRAVITY_ACP_VERSION}"

# Chromium for claude's playwright MCP. Shared, world-readable, outside any home dir so every agent
# reuses one copy instead of downloading ~150MB on first use.
echo "==> playwright MCP ${PLAYWRIGHT_MCP_VERSION} + chromium"
HOME=/root npm install -g "@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}"
PW_CORE=/usr/local/lib/node_modules/@playwright/mcp/node_modules/playwright-core/cli.js
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
export IS_SANDBOX=1
EOF
chmod 0644 /etc/profile.d/20-oyren-agents.sh

rm -rf /var/lib/apt/lists/* "/home/$SANDBOX_USER/.npm"
install -d -o "$SANDBOX_USER" -g "$SANDBOX_USER" "/home/$SANDBOX_USER/.cache"
chown -R "$SANDBOX_USER:$SANDBOX_USER" "$PNPM_HOME"

echo "✅ agent CLIs installed (claude codex gemini cursor opencode qwen antigravity)"