# Deferred: the Oyren chat participant

Run this AFTER confirming the browser editor works end-to-end on a session droplet.

## Problem

Oyren launches sandboxes for **seven** agent providers: `claude`, `codex`, `gemini`, `cursor`,
`opencode`, `qwen`, `antigravity`. The agent is selected at runtime by the `AGENT_KIND` env var and
streams over the sandbox runtime's `/agent` endpoint.

Only **one** of the seven ships a VS Code extension. Anthropic's `Anthropic.claude-code` (Open VSX,
v2.1.221) is now installed into the baked editor, so Claude sessions get a native in-editor agent
sidebar. Verified from its manifest:

- `enabledApiProposals` — **absent**, so it needs no `--enable-proposed-api` in Code-OSS
- `contributes` — `viewsContainers` + `views` (its **own** sidebar); notably **no `chatParticipants`**
- `main: ./extension.js`, no `browser` field — needs the server-side Node extension host, which
  openvscode-server provides (this is exactly why it works here but not on vscode.dev)

The other six have no in-editor presence. Their users must leave the editor and use Oyren's own chat
pane, which is now one toggle away rather than permanently on screen — workable, but it means the
editor experience is inconsistent across providers.

## What to build

A small VS Code extension, baked into the droplet snapshot, that registers a chat participant so
**VS Code's built-in Chat view** talks to Oyren's agent for every provider:

```
vscode.chat.createChatParticipant("oyren.agent", handler)
```

The handler streams from the sandbox runtime's existing `/agent` endpoint. Because the extension
host runs **inside** the droplet, it dials `127.0.0.1:<port>` directly — no session token, no CORS,
no trip through the edge.

Then flip the two settings in `deploy/editor/machine-settings.json` that currently hide the built-in
chat (`chat.commandCenter.enabled`, `chat.agent.enabled`); they are `false` today only because no
provider was wired to it.

## The one thing to verify FIRST

Whether Code-OSS 1.109.5 exposes `vscode.chat.createChatParticipant` as a **stable** API. Microsoft
has historically gated parts of chat behind proposed APIs, and Code-OSS builds strip Copilot-specific
pieces. If it needs a proposal, openvscode must be launched with
`--enable-proposed-api oyren.oyren-agent`, which is fine but must be wired into whatever starts the
editor. **Do not build the extension before settling this** — it decides whether the approach works
at all.

Note the Claude Code extension does NOT answer this question: it contributes its own view container
rather than a chat participant, so it exercises none of the chat API.

## Prompt to run

> Build the Oyren chat participant extension for the browser editor baked into our sandbox droplet
> snapshot.
>
> Context: agents run natively on a DigitalOcean droplet (no container). The composer repo
> `~/Documents/oyren.dev/oyren-ai-composer` owns everything on the droplet — read `deploy/editor/`,
> `deploy/sandbox-host/`, and `sandbox-runtime/src/server.js` for how the agent endpoint is served
> and how the editor is installed and started. `docs/oyren-chat-participant.md` states the problem.
>
> STEP 1, before writing any extension code: determine whether openvscode-server 1.109.5 exposes
> `vscode.chat.createChatParticipant` as a stable API, or whether it requires
> `--enable-proposed-api`. Check the Code-OSS source for that version and its bundled `vscode.d.ts`.
> Report the finding and how you established it. If it needs a proposal, plan how to pass the flag
> wherever openvscode is launched.
>
> STEP 2: build the extension in `deploy/editor/oyren-agent-extension/` — register the participant,
> stream from the runtime's `/agent` endpoint over `127.0.0.1`, render markdown responses
> incrementally, and surface tool calls. Package it with `@vscode/vsce` and install the resulting
> `.vsix` from `install-editor.sh`, alongside the Claude Code extension.
>
> STEP 3: un-hide the built-in chat in `deploy/editor/machine-settings.json`
> (`chat.commandCenter.enabled`, `chat.agent.enabled`) — they are false only because no provider was
> wired.
>
> Constraints: Open VSX only, never Microsoft's Marketplace (its terms forbid non-Microsoft
> products, and it is why `product.json`'s `extensionsGallery` is deliberately untouched). No AI
> attribution in commits. Work in a worktree off `origin/main`. Re-bake with
> `deploy/bake/bake-base-snapshot.sh` to test, and expect a real bake to find things a local build
> cannot — the last five each surfaced a distinct bug.
