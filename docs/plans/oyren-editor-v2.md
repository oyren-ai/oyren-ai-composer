# Oyren editor v2 — one chat for every CLI agent

Self-contained implementation plan. **Read `oyren-editor-v2-facts.md` (same directory) FIRST** — it
carries every verified file:line this plan relies on, the release/bake loop, and the house rules.
Work in this worktree (`feat/edge-admin-site`); fork work in a fresh clone of
`oyren-ai/openvscode-server` branch `oyren/1.109`.

## Context

The editor's built-in Chat view now works end to end on our fork: the sandbox agent answers, real
models show in the picker (verified live: "I'm z-ai/glm-5.1"). What remains is product polish and
the headline feature — the chat's **agent-type dropdown listing all seven CLI agents**
(opencode, cursor, codex, claude, gemini, qwen, antigravity) with **switching after launch**.
Switching is per-SESSION by design: picking an agent opens a chat session locked to that backend on
the same workspace files; transcripts do not transfer between engines.

## Workstream A — stop stamping `@oyren` on every message (extension-only)

In `deploy/editor/oyren-agent-extension/package.json` set `"isSticky": false` (sticky is what
plants `@oyren` in the input). Keep `fullName: "Oyren"` — response attribution stays "Oyren".

## Workstream B — Oyren-brand the chat panel + workbench strings (fork patches)

The empty state and workbench strings are build-inlined; these are fork commits on `oyren/1.109`.
1. New patch (gate every hunk on `!productService.defaultChatAgent`, like patches 02-04):
   - `chatWidget.ts` welcome (facts: `:902-941`): title → `Oyren Agent`; description/message →
     "One chat for every CLI agent — opencode, cursor, codex, claude, gemini, qwen and antigravity.
     The agent running in this sandbox answers here."
   - Suggested actions (`:943-975`): keep the mechanism, reword prompts to Oyren-relevant ones
     ("What is this repo and what should I look at first?", "What changed recently?").
2. CI branding: in `.github/workflows/build-oyren-release.yml`'s "Update product.json" jq step, also
   set `nameShort`/`nameLong` to `Oyren Editor` — kills the "VS Code for the Web" strings that the
   runtime overrides provably cannot reach.

## Workstream C — seven agents in the dropdown, switchable after launch

C1. **Runtime multi-engine** (`sandbox-runtime/`, independent of the fork — do first):
- Replace `engineSelect.js`'s single require-time engine with a registry `getEngine(kind)`:
  `claude-code` → `agentEngine`, others → an `acpEngine` instance per kind from `spawnConfig.js`.
  Lazy-spawn on first use; reap an engine idle > 10 min (each is a real process — RAM matters; keep
  the s tier single-engine and note ≥ m for multi-agent in the plan's acceptance).
- Thread an optional `?agent=<kind>` through `/agent/message`, `/agent/stream`, `/agent/models`,
  `/agent/model`, `/agent/interrupt` (default: the session's `AGENT_KIND`; unknown kind → 400).
  Auth (`?token=`) unchanged. Keep the tmux/TUI path untouched.
- Honesty rule: only the launch agent has seeded credentials; another engine's login-URL line just
  renders as text in the chat. Do not fake auth.
C2. **Fork patch 05** — un-hardcode the picker (3 files, exact lines in facts): drop the
  `getAgentSessionProvider` allowlist gate in `sessionTargetPickerActionItem.ts`; make
  `isAgentSessionProviderType` accept any registered contribution; add contribution-based
  name/icon/description fallbacks in `agentSessions.ts`. Gate on `!defaultChatAgent` where feasible.
  Do NOT reuse Microsoft's `claude-code`/`openai-codex` enum ids (their hardcoded labels win).
C3. **Extension** (`oyren-agent-extension`): add `"chatSessionsProvider"` to `enabledApiProposals`;
  contribute `chatSessions` entries — one per agent, `type` = our `AGENT_KIND` ids verbatim,
  friendly `displayName`, `canDelegate: true`; register per-type
  `ChatSessionItemProvider` + `ChatSessionContentProvider` whose `requestHandler` streams via the
  existing `agentClient` with `?agent=<kind>`, and per-kind models from `/agent/models?agent=`.
  Keep every file ≤100 lines — add modules rather than growing existing ones.

## Workstream D — Oyren walkthrough in the middle pane (extension-only)

Replace "Get Started with VS Code for the Web" as the thing users actually see:
- `contributes.walkthroughs` (STABLE, no proposal) in the extension: id `oyren.gettingStarted`,
  ~5 steps with markdown media: what this sandbox is; the chat (one view, many CLI agents); the
  terminal profile dropdown (tmux `main` = the web terminal, live in both); files live at
  `/home/oyren/workspace` and sync with the Oyren app; paid runtime + the `+1h` button.
- Auto-open ONCE per machine: on activation, if a `context.globalState` flag is unset, run
  `workbench.action.openWalkthrough` with our id and set the flag.
- Investigate why the core web walkthrough auto-opens despite `workbench.startupEditor: "none"`
  (gettingStarted contribution at the tag); suppress it if a setting/one-line patch covers it,
  otherwise leave it reachable under Welcome and accept ours opening on top.

## Order, release, acceptance

1. Land B + C2 on the fork first and push tag `openvscode-server-v1.109.5-oyren.2` — CI runs
   ~50-70 min; do C1/C3/A/D in the composer worktree while it builds.
2. When the release asset is live: bump `OPENVSCODE_VERSION` default to `1.109.5-oyren.2` in
   `deploy/editor/install-editor.sh`, then ONE bake + lean derive + pin both ids (loop in facts).
3. Acceptance, on a fresh session from localhost:3000: input carries no `@oyren`; empty state reads
   Oyren and names the seven agents; monitor dropdown lists all seven; picking a non-launch agent
   opens a session that streams from THAT engine on the same files (expect a login message for
   agents without seeded credentials — that is correct v1); the launch agent's chat still works;
   Oyren walkthrough opens once and never again; `pnpm`-free — runtime tests via
   `node --test sandbox-runtime/src/*.test.js` (3 pre-existing failures are environmental: missing
   local `yaml` dep + one legacy `runJobs` case — do not chase them).
4. Commit in slices per workstream, no AI attribution, explicit paths only.
