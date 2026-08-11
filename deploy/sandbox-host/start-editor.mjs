// systemd ExecStart for the browser editor (oyren-editor.service).
//
// Runs as its OWN unit rather than being launched from entrypoint.sh, which is what the container
// did. On the VM the runtime unit has Restart=always with RestartSec=2, and systemd's default
// KillMode=control-group would take a backgrounded editor down with it — so every runtime crash
// would tear down and relaunch a ~400MB editor in a two-second loop. A separate unit, pulled in by
// Wants= (not PartOf=/BindsTo=), means a runtime restart leaves the editor alone.
//
// It also does NOT need to know $WORKDIR. entrypoint.sh only resolves that after cloning, which can
// take a while; the editor instead boots on the workspace root immediately and the router 302s a
// bare hit on the base path to ?folder=$WORKDIR (see sandbox-runtime/src/ide.js).
import { spawn } from 'node:child_process'
import { mergedEnv } from './sessionEnv.mjs'

const BIN = process.env.OYREN_EDITOR_BIN ?? '/opt/openvscode-server/bin/openvscode-server'
const PORT = process.env.OYREN_EDITOR_PORT ?? '3131'
// Set in the baked /etc/oyren/host.env by install-host.sh; the literal is only a last resort for a
// droplet booted from a snapshot predating that (where /workspace is still a real directory).
const WORKSPACE_DIR = process.env.OYREN_WORKSPACE_DIR ?? '/home/oyren/workspace'
// Extension ids allowed to use proposed APIs. Keep this list SHORT: proposed APIs are unstable
// across versions, so every id here is one more thing an openvscode version bump can break. Was
// first-party-only until openai.chatgpt (Codex) needed chatSessionsProvider/languageModelProxy for
// its own chat panel to activate at all (same reason oyren-agent needs it) — third-party entries
// still require the same bar: verified need, verified proposal support, not added speculatively.
const OYREN_PROPOSAL_EXTENSIONS = ['oyren.oyren-chat-probe', 'oyren.oyren-agent', 'openai.chatgpt']

const env = mergedEnv()

// Kill switch. The smallest tiers are 1 vCPU / 1GB, shared with the agent; the editor is worth
// dropping there rather than thrashing swap.
if (env.OYREN_EDITOR === '0') {
  console.log('OYREN_EDITOR=0 — editor disabled for this session')
  process.exit(0)
}

// Fail closed. The session token is the ONLY thing gating the editor, and the editor is a
// root-capable IDE with an integrated terminal, the user's GitHub token and the agent's API keys.
// Without a token the router cannot authorise anyone, so refuse to start rather than run something
// unreachable-but-listening.
// A self-hosted install that gates the editor at its own reverse proxy sets OYREN_EDITOR_BASE_PATH
// and owns authorisation itself; everyone else must present a token or get nothing.
const token = env.SESSION_TOKEN
if (!token && env.OYREN_EDITOR_BASE_PATH === undefined) {
  console.error('SESSION_TOKEN is not set — refusing to start the editor')
  process.exit(1)
}

// The base path carries the token because openvscode derives every asset and WebSocket URL from
// --server-base-path: a query param is dropped by those, and a cookie is third-party inside our
// iframe. A self-hosted install that terminates auth at its own proxy can set OYREN_EDITOR_BASE_PATH
// (e.g. "/ide", or "" to serve at the root) — the token then gates nothing and the proxy must.
const basePath = env.OYREN_EDITOR_BASE_PATH ?? `/_oyren/ide/${token}`

const args = [
  '--host', '127.0.0.1', // never the droplet's public IP; :8080 already binds 0.0.0.0
  '--port', String(PORT),
  '--without-connection-token', // the router's path token is the gate
  '--disable-workspace-trust',
  ...(basePath ? ['--server-base-path', basePath] : []),
  '--default-folder', WORKSPACE_DIR,
  // Our own extensions only. A chat participant that declares itself the DEFAULT one — which is what
  // makes it own the Chat view rather than answer to an @mention — needs the defaultChatParticipant
  // and chatProvider proposals at 1.109. Granted per extension id, never globally.
  //
  // Deliberately a launch flag rather than product.json's extensionEnabledApiProposals: that key
  // OVERRIDES an extension's own declaration instead of merging with it, so a stale entry there
  // would silently strip proposals from a later extension that asked for more.
  ...OYREN_PROPOSAL_EXTENSIONS.flatMap((id) => ['--enable-proposed-api', id]),
]

console.log(`starting editor on 127.0.0.1:${PORT} under ${basePath || '/'}`)
const child = spawn(BIN, args, { stdio: 'inherit', env })
child.on('error', (err) => {
  console.error(`failed to exec ${BIN}: ${err.message}`)
  process.exit(1)
})
child.on('exit', (code, signal) => process.exit(signal ? 128 + 1 : (code ?? 1)))