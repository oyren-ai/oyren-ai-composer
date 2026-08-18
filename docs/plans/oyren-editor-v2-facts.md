# Oyren editor v2 — facts appendix (verified, line-quoted)

Companion to `oyren-editor-v2.md`. Everything here was verified against the tag
`openvscode-server-v1.109.5` or measured on a live droplet. Trust it over docs and over memory.

## Repos, branches, artifacts
- Composer worktree (work HERE): `~/Documents/oyren.dev/oyren-ai-composer/.claude/worktrees/edge-up`,
  branch `feat/edge-admin-site`. Editor bits: `deploy/editor/` (installer, machine-settings,
  `oyren-agent-extension/` — 5 files, every file ≤100 lines, hard rule). Runtime: `sandbox-runtime/`.
- Fork: `github.com/oyren-ai/openvscode-server`, branch `oyren/1.109` (4 patches + in-tree CI
  `.github/workflows/build-oyren-release.yml` + `oyren/npm-wrapper/`). Tag `…-oyren.1` released.
  Fresh clone: `git clone --depth 50 -b oyren/1.109 git@github.com:oyren-ai/openvscode-server.git`.
- Release asset: `https://github.com/oyren-ai/openvscode-server/releases/download/openvscode-server-v<V>/openvscode-server-v<V>-linux-x64.tar.gz`.
- Snapshots live now: base `239918869` (fork editor + all-modes extension). Pins go in the LOCAL
  orchestrator `.env.local` (`DROPLET_SNAPSHOT_ID`, `_LEAN`, `_ZED`), restart to apply.

## The one architectural fact that explains everything
**product.json is INLINED into workbench.js at build time** (`build/gulpfile.reh.ts:447` →
`createVSCodeWebFileContentMapper` → marker in `src/vs/platform/product/common/product.ts:59`).
Runtime edits to the installed product.json reach ONLY server-side readers. Any browser-visible
change (branding strings, chat gating) must be a fork commit + rebuild. That is why the fork exists.

## Chat internals at this tag (paths under src/vs/workbench/contrib/chat)
- Panel opens in **Agent mode**: `browser/widget/input/chatInputPart.ts:508`
  (`defaultMode ?? ChatMode.Agent`). No default-mode setting exists; `chat.defaultMode` is an
  experiment treatment, not config.
- `getDefaultAgent` filters by mode (`common/participants/chatAgents.ts:430-438`); a mode with no
  default agent dies SILENTLY: `chatServiceImpl.ts:822` (`!` masks undefined) → `:1108` throw
  swallowed at `:1148` — no bubble, no error. Hence the participant declares all three modes.
- Contribution passthrough for isDefault participants: `browser/chatParticipant.contribution.ts:294`.
- Model picker filters in Agent/Edit modes to `capabilities.toolCalling`
  (`common/languageModels.ts:200-203`, `chatInputPart.ts:1043`); "Auto" is a synthetic zero-models
  entry (`modelPickerActionItem.ts:52-61`). Models need `isUserSelectable`, one `isDefault`
  (`chatProvider` proposal), and EAGER `vscode.lm.selectChatModels({vendor:"oyren"})` at activation
  or resolution is lazy and the first send can throw "Language model unavailable" pre-handler.
- EMPTY-STATE ("Build with Agent") is core ChatWidget, not a contribution:
  `browser/widget/chatWidget.ts:902-941` (Agent title `:931`, Ask title `:927`), disclaimer `:166`,
  suggested actions `:943-975` (shown when `!chatEntitlementService.sentiment.installed`;
  "Build Workspace" `:965`, "Show Config" `:970`). Input placeholder = the MODE's description
  (`common/chatModes.ts:526`, surfaced by `chatInputEditorContrib.ts:168`).
- `@oyren` in the input = `isSticky: true` on the participant contribution.

## The monitor ("agent type") dropdown
- Widget `browser/widget/input/sessionTargetPickerActionItem.ts`; items `_updateAgentSessionItems`
  `:154-181` = hardcoded "Local" + `chatSessions` contributions, each FILTERED through
  `getAgentSessionProvider(type)` — allowlist enum `browser/agentSessions/agentSessions.ts:15-21`:
  `local, copilotcli, copilot-cloud-agent, claude-code, openai-codex`. Arbitrary types are stored but
  never shown here. Same allowlist: `chatSessions.contribution.ts:1267-1269` and the per-type command
  registration loop `:332-346`. Labels/icons for enum types are hardcoded switches
  (`agentSessions.ts:50-117`) — reusing id `claude-code` renders Microsoft's copy; don't.
- Extension side is REAL and third-party-usable: contribution point `chatSessions`
  (`chatSessions.contribution.ts:55-210`; proposal gate `:315` = `chatSessionsProvider`), d.ts
  `src/vscode-dts/vscode.proposed.chatSessionsProvider.d.ts`:
  `registerChatSessionItemProvider(type, provider)` `:40`,
  `registerChatSessionContentProvider(scheme, provider, participant, capabilities)` `:424`,
  `ChatSession {history, requestHandler}` `:297-334`. Set `canDelegate: true` so selection runs
  `openNewChatSessionInPlace.<type>` (`:1122-1244`) — the widget then locks to a dynamic agent
  (`_registerAgent :683-716`) and sends carry `agentIdSilent` (`chatWidget.ts:2159`).
- SEMANTICS: per-SESSION routing. Picking a type = new/other chat session locked to that backend.
  Per-message switching inside one transcript is not what this UI does.

## Sandbox runtime (composer `sandbox-runtime/`)
- ONE engine per boot today: `src/engineSelect.js` picks at require time from `AGENT_KIND`
  (`claude-code` → `src/agentEngine.js` SDK engine; else `src/acpEngine.js` + `src/acp/spawnConfig.js`
  table: codex-cli→`codex-acp`, gemini-cli→`gemini --experimental-acp`, qwen-code→`qwen
  --experimental-acp`, opencode→`opencode acp`, cursor-cli→`agent acp`, antigravity-cli→`antigravity-acp`).
- Endpoints (`src/agentChat.js`, `src/agentControl.js`, auth `src/agentHttp.js` `?token=SESSION_TOKEN`,
  port `PORT` env default 8080, loopback from the extension host): `POST /agent/message`
  (`&follow=1` streams the turn's NDJSON until the `result` line), `GET /agent/models` →
  `{models:[{value,displayName}], current}`, `POST /agent/model` `{model}`, `POST /agent/interrupt`.
  NDJSON line shapes: `src/acp/translate.js` (the extension's `renderStream.js` mirrors them).
- Auth seeding is for the LAUNCH agent only (`src/seedAgentAuth.js` etc.) — another engine may emit
  its login-URL line; the extension renders whatever text arrives, which is acceptable v1 behavior.
- Editor proposals: `deploy/sandbox-host/start-editor.mjs` `OYREN_PROPOSAL_EXTENSIONS` →
  `--enable-proposed-api <id>` per id. NEVER use product `extensionEnabledApiProposals` (it
  OVERRIDES an extension's own list). Machine settings: `deploy/editor/machine-settings.json`.
- MCP launcher (for later layers): orchestrator MCP tool `launch_agent`
  `{fromSession, prompt, agentKind, app, size}`; connections in env `OYREN_MCP_SERVERS` (JSON array),
  session id in `OYREN_SESSION_UUID`. Design doc: `docs/oyren-chat-launch.md`.

## Release / bake loop (each step verified this week)
1. Fork change → commit on `oyren/1.109` → `git tag openvscode-server-v1.109.5-oyren.N` → push
   branch + tag → CI builds on free runners ~50-70 min (`gh run watch --repo
   oyren-ai/openvscode-server`). Caches don't cross tags; every build is cold. `fetch-depth: 50`
   must keep covering the "code web server initial commit" grep (17 + patch count commits).
2. Composer: bump the `OPENVSCODE_VERSION` default in `deploy/editor/install-editor.sh` (an
   `-oyren.` version auto-selects our fork's release URL).
3. Bake (~15 min, sanctioned): `cd deploy/bake && DO_API_TOKEN="$(doctl auth token)"
   DO_SSH_KEY_ID=49858195 DO_REGION=fra1 ./bake-base-snapshot.sh`; then
   `BASE_SNAPSHOT_ID=<new> ./derive-lean-snapshot.sh` and `… ./derive-zed-snapshot.sh` (streamed
   Zed — verify its stream on an xl session; the installer's asserts gate the pinned Zed/KasmVNC).
   Pin the ids in the local orchestrator `.env.local`, restart it, launch a session from
   localhost:3000 (do NOT hand-create droplets).
4. Extension/runtime-only changes need only steps 3; fork changes need 1-3.

## House rules
Open VSX only, never Microsoft's Marketplace. No AI attribution in commits. Every file ≤100 lines
(split modules). Stage explicit paths only — other agent sessions edit these trees concurrently.
