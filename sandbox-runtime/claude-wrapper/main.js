#!/usr/bin/env node
// oyren-claude-wrapper v2 — what claudeCode.claudeProcessWrapper points at (machine-settings.json).
//
// The extension spawns `wrapper <real-claude-binary> --output-format stream-json ...` with pipes,
// no shell, no TTY, and expects `exec "$@"` semantics: argv[1..] run VERBATIM (argv[0] here — we
// never substitute our own claude path), byte-exact stdio, never a PTY (the CLI hard-fails
// --input-format=stream-json on a TTY, and PTY echo corrupts NDJSON), signals forwarded, exit
// codes mirrored. It also reuses this wrapper for secondary spawns (--claude-in-chrome-mcp), so
// nothing here may assume a chat-shaped argv.
//
// OYREN_CLAUDE_WRAPPER !== "1": pure passthrough — behaviorally identical to no wrapper at all.
// This is deliberate and load-bearing: shipping the binary alone changes nothing for any session.
//
// "1": relay the spawn to the broker (server.js's maybeStartClaudeWrapperBroker) over its unix
// socket, so the BROKER owns the child. A panel close then only kills this relay — the broker lets
// the in-flight turn finish and claude flush its transcript for --resume (Level B survival; see
// src/claudeWrapperDrain.js). Broker unreachable/refusing/at-cap: ONE stderr line (never stdout —
// that channel is the extension's NDJSON), then passthrough.
const { passthrough, fatal } = require("./passthrough")

const argv = process.argv.slice(2)
if (argv.length === 0) fatal("no command given — expected: oyren-claude-wrapper <claude-binary> [args...]")

if (process.env.OYREN_CLAUDE_WRAPPER !== "1") {
  passthrough(argv)
} else {
  require("./relay").startRelay(argv, {
    onFallback: (reason, pendingStdin) => {
      process.stderr.write(`oyren-claude-wrapper: ${reason} — falling back to a direct spawn\n`)
      passthrough(argv, pendingStdin)
    },
  })
}
