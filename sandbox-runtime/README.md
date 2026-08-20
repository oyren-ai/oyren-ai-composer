# oyren-sandbox

A single, long-lived container that gives a user (or AI agent) a cloud workspace for one repo:
an interactive terminal **and** a place to run their app — behind one port, with a reverse proxy.
It merges the old `repo-terminal` and `app-runner` images.

One Node process listens on **port 8080** (the only exposed port; DigitalOcean App Platform routes
to it) and dispatches by path:

| Path | Handler | Auth |
|------|---------|------|
| `GET /_oyren/health` | always `200` (DO health check) — **never proxied** | none |
| `POST /_oyren/control/{expose,start,restart,stop,status}` | app supervisor control | `CONTROL_TOKEN` |
| `WS /terminal?token=…` | tmux PTY over WebSocket | `SESSION_TOKEN` |
| `GET /how-to-deploy[/…]` | static three.js page explaining how to deploy | none |
| everything else | reverse-proxy to the user's app on the exposed port (HTTP + WS); else the how-to-deploy page | n/a |

The pre-installed AI coding CLIs (`claude`, `opencode`, `qwen`, `gemini`, `codex`) and tmux carry
over from repo-terminal.

## Deploying your app

From the terminal (the `oyren` CLI talks to the local control API):

```bash
oyren expose 3000   # route the public URL → your app on :3000 (writes port into oyren.yml)
oyren start         # run your app via the oyren manifest's start command (managed)
oyren restart       # restart the managed app   ·   oyren status   # check it
```

"Managed" mode runs your app via an **oyren manifest** (`oyren.yml` / `oyren.ts`, resolved by
`runner/oyren-resolve.mjs`). Manual mode is also fine: run your app yourself in the terminal, then
`oyren expose <port>` to point the public URL at it. Your app must bind `0.0.0.0:$PORT`
(or the port you expose).

## Environment variables

| Var | Purpose |
|-----|---------|
| `PORT` | the single exposed port (default 8080) |
| `SESSION_TOKEN` | secret the browser presents to open the `/terminal` WebSocket |
| `CONTROL_TOKEN` | **orchestrator-only** secret for `/_oyren/control/*` (the browser must not know it) |
| `REPO_FULL_NAME` | `owner/repo` cloned into `/workspace/<repo>` on start; that folder becomes the default `WORKDIR`/`WORKING_DIR` (repo root for terminals, agents, manifest) |
| `GITHUB_TOKEN` | short-lived token for cloning a private repo (stripped from the remote after) |
| `OYREN_MODE` | `dev` or `prod` — picks the manifest's `dev` vs `start` command |
| `AGENT_KIND` | CLI coding agent to auto-launch in tmux (`claude-code`, …); absent ⇒ plain shell. `deepseek-harness` is the one kind that paints no TUI — its pane runs `oyren-dsh-web`, which serves dsh's browser UI at the session URL |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude subscription setup-token. `seedClaudeAuth` writes it to `~/.claude/.credentials.json` so **interactive** `claude` boots authenticated — interactive `claude` ignores this env var directly (it's headless/`-p` only), so the file is required, not optional |
| `AGENT_CONTEXT_B64` | base64 launch context (chatbot character/instructions); `seedAgentContext` appends it under a marker block in the provider's context file at the repo root (`CLAUDE.md`/`AGENTS.md`/`GEMINI.md`/`QWEN.md`) |
| `CODEX_AUTH_JSON_B64` | base64 Codex subscription credential; `seedAgentAuth` writes it to `~/.codex/auth.json` (0600) |
| `CODEX_CONFIG_TOML_B64` | base64 Codex `config.toml` (e.g. the orchestrator-rendered oyren OpenRouter `model_providers` block) → `~/.codex/config.toml` |
| `OPENROUTER_API_KEY` | oyren-wallet OpenRouter key; `seedAgentAuth` wires it into `~/.config/opencode/opencode.json` via an `{env:…}` placeholder (the secret itself stays in the env) |
| `GEMINI_API_KEY` | Gemini BYOK API key, read by the CLI from env; `seedAgentAuth` pins `selectedAuthType: gemini-api-key` in `~/.gemini/settings.json` so it isn't ignored |
| `GEMINI_OAUTH_CREDS_B64` | base64 Gemini subscription `oauth_creds.json` → `~/.gemini/oauth_creds.json` (auth type pinned to `oauth-personal`) |
| `CURSOR_API_KEY` | Cursor API key — `agent` / `cursor-agent` reads it from the env directly (no file seeding). Unattended approval is seeded into `~/.cursor/cli-config.json` by `seedCursorSettings` |
| `OPENCODE_MODEL` | opencode default model id (`openrouter/<model>`), written as `model` into `opencode.json` |
| `DEEPSEEK_API_KEY` | DeepSeek Harness (`dsh`) key — read from the inherited environment by dsh itself, so nothing is seeded. Its Settings → Models page is the alternative, which stores the key in `$DSH_HOME/.credentials.yaml` |
| `OYREN_DSH_PORT` | loopback port for the DeepSeek Harness web UI (default `3080`) |
| `OYREN_DSH_ROUTE` | proxy prefix `oyren-dsh-web` registers for that UI (default `/`; `none` skips it). dsh serves root-absolute assets, so a stripped prefix breaks it — see `dsh-web.sh` |
| `OYREN_BROWSER_PORT` | loopback KasmVNC port for the in-VM browser (default `6091`); the router serves it at `/_oyren/browser/<token>/`. That browser's `localhost` is the sandbox, which is what makes an agent CLI's loopback OAuth callback completable |
| `OYREN_BROWSER_IDLE_MINUTES` | stop the browser after this long with no viewer (default `30`, `0` disables). Cheap to resume: its Chrome profile is on disk, so a completed login survives the stop |
| `OYREN_BROWSER_START_URL` | page the browser opens with (default `about:blank`) |
| `OYREN_BROWSER_PROFILE` | Chrome profile dir (default `$HOME/.oyren-browser`) |

## Develop & test

```bash
pnpm install            # builds node-pty's native addon
pnpm test               # node:test unit + integration suite (no Docker, no DO)
./build-and-push.sh     # docker build --platform linux/amd64 + push oyrendev/oyren-sandbox:latest
```

The branded `*.oyren.ai` URL is served by oyren-ai-next's Next.js rewrite proxying to this
container's `*.ondigitalocean.app` URL — this image only needs its single port.
