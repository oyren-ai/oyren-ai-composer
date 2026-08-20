#!/usr/bin/env bash
# oyren-welcome — banner shown when a terminal session opens.
# Re-run any time with `oyren-help`.
set -u

# Each per-agent image (oyren-sandbox-<agent>) layers exactly one CLI on the base, so detection below
# only lists what's actually installed in THIS image. The pnpm global bin is where those CLIs land, but a
# login shell's /etc/profile sources /etc/bash.bashrc (which fires this banner) *before* profile.d
# re-adds PNPM_HOME — so prepend it here first, or `command -v` would miss the CLI. Matches Dockerfile
# (ENV PATH) + agent-launch.sh.
# OYREN_AGENT_PATH exists so a test can pin down which CLIs the banner can see: with the real
# directories baked in, "does it list X" would assert whatever the machine running the test happens
# to have installed. Production never sets it.
export PATH="${OYREN_AGENT_PATH:-/usr/local/share/pnpm:/app/node_modules/.bin}:$PATH"

# Colors only when stdout is a TTY (avoids escape codes in logs/pipes).
if [ -t 1 ]; then
  CY=$'\033[1;36m'; GR=$'\033[1;32m'; YL=$'\033[1;33m'; B=$'\033[1m'; D=$'\033[2m'; X=$'\033[0m'
else
  CY=''; GR=''; YL=''; B=''; D=''; X=''
fi

repo="${REPO_FULL_NAME:-—}"

# Print one assistant line only if its CLI is on PATH (i.e. installed in this image).
print_assistant() {
  command -v "$1" >/dev/null 2>&1 || return 0
  printf '    %s%-12s%s %s\n' "$GR" "$1" "$X" "$2"
}
assistants="$(
  print_assistant claude       "Claude Code (Anthropic)"
  print_assistant opencode     "opencode — open-source, multi-model"
  print_assistant qwen         "Qwen Code (Alibaba)"
  print_assistant gemini       "Gemini CLI (Google)"
  print_assistant codex        "Codex CLI (OpenAI)"
  # cursor-agent, not the `agent` alias it also installs: `agent` is too generic to print as an
  # instruction here, and both symlinks point at the same binary (see install-agents.sh).
  print_assistant cursor-agent "Cursor CLI (Cursor)"
  # dsh is the one agent you do not simply type: it serves a browser UI rather than a TUI, and
  # oyren-dsh-web is what starts it AND puts it on this session's public URL (see dsh-web.sh).
  print_assistant dsh          "DeepSeek Harness — run \`oyren-dsh-web\` for its browser UI"
)"

cat <<EOF

${CY}  Oyren cloud sandbox${X}
  ${D}repo${X} ${repo}   ${D}dir${X} ${PWD}
EOF

# Only show the assistants block when this image actually ships a CLI (the plain base ships none).
if [ -n "$assistants" ]; then
cat <<EOF

  ${B}AI coding assistant — type it to start:${X}
${assistants}
EOF
fi

cat <<EOF

  ${B}Deploy your app — make it reachable at this sandbox's URL:${X}
    ${YL}oyren expose <port>${X}  point the public URL at your app (writes oyren.yml)
    ${YL}oyren start${X}          run your app via the oyren manifest (managed)
    ${YL}oyren restart${X}        restart it   ${YL}oyren status${X}  check it

  ${D}Your app must bind 0.0.0.0:\$PORT (or the port you expose).
  This terminal runs inside tmux, so your work keeps running if you disconnect —
  just reconnect. To leave tmux: ${X}${GR}Ctrl-b${X} ${D}then${X} ${GR}d${X}${D} detaches (the session keeps
  running). In Zed's terminal panel,${X} ${GR}zed-term plain${X}${D} makes new tabs plain shells.
  Show this again with${X} ${GR}oyren-help${X}${D}.${X}

EOF
