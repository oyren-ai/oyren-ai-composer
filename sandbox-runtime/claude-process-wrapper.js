#!/usr/bin/env node
// The Claude Code VS Code extension's actual `claude` replacement, once
// `claudeCode.claudeProcessWrapper` points at this file (machine-settings.json, openvscode-server).
//
// Kill switch: OYREN_CLAUDE_WRAPPER unset/not "1" is a PURE PASSTHROUGH — spawn the real claude and
// mirror its exit, behaviorally identical to not having the setting at all. This is deliberate and
// load-bearing: flipping the machine-setting alone (a rolling editor-extras publish) changes nothing
// for any session until the env flag is also set.
//
// When on: this process does NOT run claude itself. It connects to the broker's unix socket (a
// long-lived process independent of this one, already running inside sandbox-runtime's server.js)
// and relays its own stdio to it, byte for byte, in both directions. It never parses claude's own
// stream-json/ACP output — only the one handshake line that routes this connection to a session.
//
// This is the actual disconnect-survival mechanism: the extension's onDidDispose sends this process
// SIGTERM then SIGKILL on every panel close. Because the BROKER (not this process) holds the real
// claude child's pipes open, killing this process just closes a socket connection — the child never
// sees a signal or an EPIPE. The next panel open spawns a fresh wrapper that reattaches silently.
const net = require("net")

const REAL_CLAUDE_BIN = process.env.OYREN_CLAUDE_REAL_BIN || "/usr/local/share/pnpm/claude"
// install-runtime.sh installs THIS file standalone at /usr/local/bin/oyren-claude-wrapper — no
// sibling src/ tree travels with it, so the default below is a deliberate literal duplicate of
// src/claudeWrapperSocketPath.js's DEFAULT_SOCKET_PATH (which startClaudeWrapperBroker.js uses from
// inside $APP_DIR, where relative requires still resolve). Keep the two literals in sync.
const SOCKET_PATH = process.env.OYREN_CLAUDE_WRAPPER_SOCKET || "/tmp/oyren-claude-wrapper.sock"
const WRAPPER_ARGS = process.argv.slice(2)

/** Best-effort session-key derivation from argv. Phase 0 of CONTINUITY_DESIGN_PLAN.md calls for
 *  observing the REAL extension's argv shape live before finalizing this — no browser/computer-use
 *  tool was available to do that here. Falls back to one well-known key per server (the plan's own
 *  pre-approved contingency), sacrificing multi-conversation support for v1 rather than silently
 *  guessing wrong. Update this function once a real spike confirms the actual shape; nothing else
 *  needs to change (the socket handshake already carries an arbitrary key). */
function deriveSessionKey(argv) {
  const idx = argv.findIndex((a) => a === "--session-id" || a === "--resume")
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1]
  return "default"
}

/** Exec the real claude directly, inheriting stdio, mirroring its exit code/signal. This is both the
 *  flag-off path and the fallback if the broker is unreachable — a wrapper that can't reach its
 *  broker should degrade to today's behavior, not make the Chat panel unusable. */
function passthrough() {
  const { spawn } = require("child_process")
  const child = spawn(REAL_CLAUDE_BIN, WRAPPER_ARGS, { stdio: "inherit" })
  child.on("error", (err) => {
    console.error(`oyren-claude-wrapper: failed to exec ${REAL_CLAUDE_BIN}: ${err.message}`)
    process.exit(1)
  })
  child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)))
}

function relayed() {
  const sessionKey = deriveSessionKey(WRAPPER_ARGS)
  const socket = net.createConnection(SOCKET_PATH)
  let handshakeSent = false

  socket.on("connect", () => {
    handshakeSent = true
    socket.write(`${JSON.stringify({ sessionKey })}\n`)
    process.stdin.pipe(socket)
    socket.pipe(process.stdout)
  })
  // Broker unreachable (not running, stale socket file, cap reached and refused before the
  // handshake landed) — degrade to a direct spawn rather than leaving the Chat panel dead.
  socket.on("error", (err) => {
    if (handshakeSent) return // mid-relay socket errors are just "the broker connection dropped" — let 'close' handle exit
    console.error(`oyren-claude-wrapper: broker unreachable (${err.message}) — falling back to a direct spawn`)
    passthrough()
  })
  socket.on("close", () => process.exit(0))
  process.stdin.on("error", () => { /* EPIPE once the socket closes first — not this process's problem */ })
}

if (require.main === module) {
  if (process.env.OYREN_CLAUDE_WRAPPER === "1") relayed()
  else passthrough()
}

module.exports = { deriveSessionKey }
