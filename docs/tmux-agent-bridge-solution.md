# Tmux Agent Bridge Solution

## Goal

Let an Oyren agent observe and, when safe, message any live agent-like process running in tmux panes on the same machine.

## Current Shape

- Headless agent containers already expose structured, token-gated HTTP endpoints:
  - `POST /agent/message`
  - `GET /agent/stream`
  - `GET /agent/current`
  - `POST /agent/interrupt`
- The orchestrator already wraps those endpoints as agent tools such as `read_agent` and `send_agent`.
- Tmux panes are different: they are raw terminal sessions. We can always read their screen and type into them, but we cannot always know whether a pane is an agent, a shell, a build, an editor, or a login prompt.

## Recommended Design

Add a small "tmux bridge" beside the existing `/agent/*` runtime endpoints.

### 1. Discover Panes

Add a token-gated endpoint:

`GET /tmux/panes`

It should run:

`tmux list-panes -a -F "#{session_name}\t#{window_index}\t#{pane_index}\t#{pane_id}\t#{pane_current_command}\t#{pane_current_path}\t#{pane_title}"`

Return normalized pane records:

- `id`: tmux pane id, for example `%3`
- `target`: stable tmux target, for example `main:0.1`
- `command`: current foreground command
- `cwd`: current directory
- `title`: pane title
- `likelyAgent`: true when command/title/process tree matches known CLIs such as `claude`, `codex`, `opencode`, `gemini`, `dsh`
- `mode`: `structured` or `tty`

### 2. Read Panes

Add:

`GET /tmux/panes/:id/screen?lines=200`

It should run:

`tmux capture-pane -p -J -S -200 -t <pane-id>`

Use this for observation. It is passive and should be available for every pane.

### 3. Message Panes

Add:

`POST /tmux/panes/:id/input`

Body:

```json
{ "text": "message to send", "enter": true }
```

Implementation:

`tmux send-keys -t <pane-id> -- <text>`

Then, if `enter` is true:

`tmux send-keys -t <pane-id> Enter`

This is inherently less safe than `/agent/message`, because it types into whatever owns the terminal. The API should require the caller to pass the last observed command/title or a recent pane version so we do not type into a pane that changed after discovery.

### 4. Prefer Structured Agent Adapters

For panes that advertise a known agent transport, prefer that over keystrokes.

Examples:

- Existing headless agents: use `/agent/message` and `/agent/stream`.
- Context7 MCP: call the MCP tool directly when the desired action is documentation lookup.
- Future pane agents: let them publish a local socket or HTTP endpoint in an env var or pane title, then mark `mode: "structured"`.

Raw tmux input should be the fallback, not the first choice.

### 5. Expose Through Orchestrator/MCP

Mirror the current `read_agent` / `send_agent` shape with new tools:

- `list_tmux_panes(sessionId)`
- `read_tmux_pane(sessionId, paneId, lines?, afterCursor?)`
- `send_tmux_pane(sessionId, paneId, text, enter?)`

The orchestrator should call the container runtime endpoint using the same session token resolution already used by `readAgentOutput` and `sendAgentTask`.

### 6. Safety Rules

- Never send input to a pane unless the caller names the exact pane.
- Show `command`, `cwd`, and a short screen preview before sending.
- Reject input if the pane changed command, died, or was replaced after discovery.
- Redact captured output before returning it if it looks like secrets.
- Keep all endpoints `SESSION_TOKEN` gated.
- Log input events as metadata only: pane id, command, timestamp, byte count. Do not log full prompts by default.

## Implementation Points

Runtime files to extend:

- `sandbox-runtime/src/agentHttp.js`: reuse token checking and JSON helpers.
- `sandbox-runtime/src/server.js` or route wiring: register `/tmux/*`.
- Add `sandbox-runtime/src/tmuxBridge.js`: pane listing, capture, and input helpers.
- Add focused tests beside `terminal.test.js` and `agentChat.test.js`.

Orchestrator files to extend:

- `oyren-orchestrator/src/services/terminalContainers/resolveAgentEndpoint.ts`: reuse endpoint resolution.
- Add service wrappers similar to:
  - `readAgentOutput.ts`
  - `sendAgentTask.ts`
  - `agentSessionControl.ts`
- Expose the wrappers through the MCP workspace tools.

## Minimal First Version

Ship only:

1. `GET /tmux/panes`
2. `GET /tmux/panes/:id/screen`
3. `POST /tmux/panes/:id/input`
4. MCP wrappers for list/read/send

That gives us useful observation and controlled typing without changing how existing agents run. Structured per-agent adapters can come later.
