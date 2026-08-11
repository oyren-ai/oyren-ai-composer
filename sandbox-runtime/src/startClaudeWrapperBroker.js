// Boots the disconnect-survival broker for the native Chat panel's claude process — a registry +
// unix socket server, flag-gated behind OYREN_CLAUDE_WRAPPER (the same flag claude-process-wrapper.js
// checks independently, so either half alone being off is enough to fully disable this). No-op
// unless explicitly enabled: a session that never sets the flag boots identically to before this
// feature existed.
const { createRegistry } = require("./claudeWrapperRegistry")
const { startSocketServer } = require("./claudeWrapperSocket")
const { DEFAULT_SOCKET_PATH } = require("./claudeWrapperSocketPath")

function maybeStartClaudeWrapperBroker() {
  if (process.env.OYREN_CLAUDE_WRAPPER !== "1") return null
  const registry = createRegistry()
  const server = startSocketServer(DEFAULT_SOCKET_PATH, registry)
  console.log(`[claude-wrapper] broker listening on ${DEFAULT_SOCKET_PATH}`)
  return { registry, server }
}

module.exports = { maybeStartClaudeWrapperBroker }
