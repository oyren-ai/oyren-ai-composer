#!/usr/bin/env bash
# Open a coding agent inside the browser editor's integrated terminal, via tmux.
#
# Why tmux rather than running the agent directly: the SAME tmux session backs Oyren's own web
# terminal (see src/terminal.js, `tmux new-session -A -s main`). Attaching to it from the editor
# gives one conversation visible in both places, live, with no syncing to build — and closing the
# editor tab only detaches, so the agent survives.
#
# With no argument it attaches to `main`: whatever agent this session was launched with, already
# running. With an agent id it opens that agent in its own session, which is what makes the editor's
# terminal-profile dropdown a working agent picker — every agent CLI is baked into the snapshot, so
# any of them can start without a re-launch.
#
# NOTE the second form starts a SEPARATE agent process. It shares the filesystem with the first (the
# point of the exercise) but not the conversation, and only the agent this session was launched with
# is guaranteed to have credentials seeded — see seedAgentAuth.js.
#
# Env:
#   OYREN_AGENT_LAUNCH  the launcher to run inside tmux (default /app/agent-launch.sh). Overridable
#                       so a self-hosted install can put the runtime somewhere other than /app.
set -u

KIND="${1:-}"

# tmux is configured globally at /etc/tmux.conf (mouse scroll, 50k scrollback, OSC 52 clipboard),
# and `-u` forces UTF-8 so the agents' box-drawing glyphs survive.
if [ -z "$KIND" ]; then
  exec tmux -u new-session -A -s main
fi

case "$KIND" in
  claude-code | qwen-code | gemini-cli | codex-cli | opencode | cursor-cli | antigravity-cli) ;;
  *)
    echo "Unknown agent '$KIND'." >&2
    exit 64
    ;;
esac

# `-e` sets the env for the session rather than for one command, so the auto-restart loop inside
# agent-launch.sh still sees AGENT_KIND after the agent crashes and is relaunched.
exec tmux -u new-session -A -s "agent-$KIND" -e "AGENT_KIND=$KIND" "${OYREN_AGENT_LAUNCH:-/app/agent-launch.sh}"
