#!/usr/bin/env bash
# Launch the selected CLI coding agent inside the tmux "main" session, authenticated from the env the
# orchestrator injected (AGENT_KIND + the per-routing LLM vars). Falls through to an interactive login
# shell when the agent exits or AGENT_KIND is unknown, so the pane is never left dead.
export PATH="/usr/local/share/pnpm:/app/node_modules/.bin:$PATH"
WORKDIR="${WORKING_DIR:-/workspace}"

# Self-heal HOME/.cache/.config if a prior process (e.g. a `sudo` call that preserved HOME, or a
# platform volume remount) left one of them root-owned — every CLI below does its own `mkdir -p` into
# one of these and throws EACCES otherwise (idempotent; a silent no-op on the healthy path). Runs
# first since every seed step after this one writes into HOME too. When the repair can't be performed
# (no sudo under the platform's no-new-privileges), it falls back to redirecting XDG_CACHE_HOME —
# capture that from the child and export it here, so the agent this script launches inherits it.
OYREN_CACHE_HOME="$(node -e 'require("/app/src/ensureHomeWritable").ensureHomeWritable(); process.stdout.write(process.env.XDG_CACHE_HOME || "")' 2>/dev/null || true)"
[ -n "$OYREN_CACHE_HOME" ] && export XDG_CACHE_HOME="$OYREN_CACHE_HOME"

# Seed Claude onboarding/trust for this workdir so a subscription login lands prompt-free (idempotent;
# a no-op without CLAUDE_CODE_OAUTH_TOKEN).
node -e 'require("/app/src/seedClaudeAuth").seedClaudeAuth({ workdir: process.env.WORKING_DIR || "/workspace" })' 2>/dev/null || true

# Seed any oyren MCP servers the orchestrator selected into ~/.claude.json (idempotent; a no-op without
# OYREN_MCP_SERVERS) so the agent can read/write the workspace and track tasks with no manual setup.
node -e 'require("/app/src/seedMcpServers").seedMcpServers()' 2>/dev/null || true

# Seed the image-bundled Playwright MCP server (local stdio process → headless chromium) into
# ~/.claude.json when the launch enabled it. Gated by the OYREN_PLAYWRIGHT_MCP on/off flag — a local
# stdio server has no URL/token, so it can't ride OYREN_MCP_SERVERS above (idempotent; a no-op
# without the flag; only meaningful on images that bundle @playwright/mcp, i.e. oyren-sandbox-claude).
node -e 'require("/app/src/seedPlaywrightMcp").seedPlaywrightMcp()' 2>/dev/null || true

# Seed ~/.claude/settings.json so `claude` boots in bypassPermissions mode and never asks for a
# tool-use permission — an autonomous sandbox the user can leave alone (idempotent; unconditional so
# it covers both the OAuth and ANTHROPIC_BASE_URL auth paths). Allowed because we run as non-root.
node -e 'require("/app/src/seedClaudeSettings").seedClaudeSettings()' 2>/dev/null || true

# Seed ~/.cursor/cli-config.json so `agent` / `cursor-agent` boots in unrestricted approval with the
# nested sandbox disabled — the Cursor analog of Claude's bypassPermissions (idempotent; a no-op on
# images that never run cursor, but harmless: only writes into ~/.cursor).
node -e 'require("/app/src/seedCursorSettings").seedCursorSettings()' 2>/dev/null || true

# Seed the bundled Claude skills (e.g. the "finding-skills" helper) into ~/.claude/skills so both the
# interactive `claude` and the headless `claude -p` chat discover them by description (idempotent; a
# no-op when the image ships no /app/skills).
node -e 'require("/app/src/seedClaudeSkills").seedClaudeSkills()' 2>/dev/null || true

# Seed user-selected Skills (AGENT_SKILLS_B64, from the launch's Skill picker / settings defaults) into
# ~/.claude/skills/<id> alongside the bundled ones above — additive only, never touches the bundled ids
# (idempotent; a no-op without AGENT_SKILLS_B64).
node -e 'require("/app/src/seedUserSkills").seedUserSkills()' 2>/dev/null || true

# Seed per-provider agent auth files (codex auth.json/config.toml, gemini oauth creds + auth type,
# opencode provider config) from the orchestrator-injected env (idempotent; a no-op without the
# CODEX_*_B64 / GEMINI_* / OPENROUTER_API_KEY vars — qwen/cursor are env-only and need no files).
node -e 'require("/app/src/seedAgentAuth").seedAgentAuth()' 2>/dev/null || true

# Seed the launch's composed agent context (AGENT_CONTEXT_B64) into the provider-convention context
# file at the repo workdir (CLAUDE.md / GEMINI.md / QWEN.md / AGENTS.md) under a marker block that
# re-runs replace (idempotent; a no-op without AGENT_CONTEXT_B64).
node -e 'require("/app/src/seedAgentContext").seedAgentContext()' 2>/dev/null || true

# Seed the runtime workflow guidance (PR-first draft-PR journal, step commits, memory-capped local
# execution of heavy commands, restart durability) as a second marker block in the same context file —
# for every agent kind (idempotent; a no-op for repo-less sessions).
node -e 'require("/app/src/seedRuntimeGuidance").seedRuntimeGuidance()' 2>/dev/null || true

# Claude Code with a base-URL override (oyren OpenRouter / z.ai) requires an explicitly-empty
# ANTHROPIC_API_KEY, else it prefers that var over ANTHROPIC_AUTH_TOKEN. App Platform can't ship an
# empty env value, so set it here at launch.
if [ -n "${ANTHROPIC_BASE_URL:-}" ]; then export ANTHROPIC_API_KEY=""; fi

cd "$WORKDIR" 2>/dev/null || cd /workspace

# This script is pre-launched (entrypoint) BEFORE the browser attaches, so the tmux session is still at
# the no-client 80-col default. Launching the agent now means its first paint (e.g. Claude Code's welcome
# box) is locked to 80 cols and looks truncated once the real, wider terminal attaches. Wait (up to ~12s)
# for a client to attach AND propagate its real width, so the agent draws at the true size from the start.
# Skipped for the DeepSeek Harness: it paints no TUI (the pane runs a web server), so waiting on a
# terminal width that never matters would just delay its UI by 12s on every session with no browser
# terminal attached.
if [ "${AGENT_KIND:-}" != "deepseek-harness" ]; then
  for _ in $(seq 1 60); do
    attached="$(tmux display-message -p '#{session_attached}' 2>/dev/null || echo 0)"
    width="$(tmux display-message -p '#{window_width}' 2>/dev/null || echo 80)"
    [ "$attached" != "0" ] && [ "${width:-80}" -gt 80 ] && break
    sleep 0.2
  done
fi

# Optional model override: the orchestrator injects AGENT_MODEL to pick which model the CLI runs
# (a subscription alias like `sonnet`/`opus`, or a gateway model id for the ANTHROPIC_BASE_URL path).
# Passed as `--model` — the flag every supported CLI accepts (deepseek-harness is the exception; see
# its case below). Empty ⇒ each CLI's own default.
model_args=()
[ -n "${AGENT_MODEL:-}" ] && model_args=(--model "$AGENT_MODEL")

# The HTTP "Agent app" (AGENT_PROTOCOL=http-stream-json) drives Claude per HTTP turn via the headless
# `claude -p` that server.js spawns — so do NOT ALSO launch a second, persistent interactive `claude`
# here. Two full Claude processes on a large repo is the likely OOM that kills the container mid-turn
# ("exited with code 128", no JS breadcrumb). The seed steps above still ran, so the per-turn agent is
# fully set up; this tmux pane is just a plain shell. CLI-agent-in-terminal launches (no AGENT_PROTOCOL)
# keep their pre-launched TUI unchanged.
if [ "${AGENT_PROTOCOL:-}" = "http-stream-json" ]; then
  echo "Agent app (HTTP chat) — the chat drives Claude each turn; this terminal is a plain shell."
else
  # Auto-restart loop: if the agent crashes/exits, restart it instead of falling through to a dead shell.
  # Gives the user a live agent after transient crashes (OOM, network blip, upstream API 5xx). The loop
  # stays live until the container is stopped, so a user can always interact with the agent.
  while true; do
    case "${AGENT_KIND:-}" in
      claude-code)     claude "${model_args[@]}" ;;
      qwen-code)       qwen "${model_args[@]}" ;;
      gemini-cli)      gemini "${model_args[@]}" ;;
      codex-cli)       codex "${model_args[@]}" ;;
      opencode)        opencode "${model_args[@]}" ;;
      cursor-cli)      agent "${model_args[@]}" ;;
      antigravity-cli) agy "${model_args[@]}" ;;
      # DeepSeek Harness has no TUI: its interactive surface is a web app, so this pane runs the
      # server (and its logs) while the user works in the browser at the session URL. No model_args —
      # `dsh web` has no --model and would refuse to boot on the unknown flag; see dsh-web.sh.
      deepseek-harness) oyren-dsh-web ;;
      *)               echo "Unknown agent '${AGENT_KIND:-}' — opening a shell."; break ;;
    esac
    echo "Agent exited. Restarting in 2 seconds... (Ctrl+C to stop)"
    sleep 2
  done
fi

exec bash -l
