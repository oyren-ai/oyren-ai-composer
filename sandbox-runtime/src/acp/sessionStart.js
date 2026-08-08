// The ACP handshake, extracted from acpEngine so session RESUME lives in one place: initialize →
// session/load when a persisted id exists AND the agent advertises the loadSession capability
// (gemini/qwen/opencode; codex falls through) → else session/new — persisting whichever id is live
// for the next boot (acpSession.js). session/load replays the prior conversation through the same
// session/update notifications the engine already translates, so a respawned child resumes
// mid-context; a failed/unknown-id load falls back to a fresh session instead of wedging startup.
const { mcpServersFromEnv } = require("./mcpServers")
const { normalizeSessionModels } = require("./models")
const acpSession = require("./acpSession")

const PROTOCOL_VERSION = 1
const CLIENT_CAPABILITIES = { fs: { readTextFile: false, writeTextFile: false }, terminal: false } // no client fs/terminal in v1
// initialize + session/new|load must answer fast; a stall = broken startup (unreachable MCP / bad
// creds). Bound it so startup fails with a visible error instead of looping/hanging forever.
const HANDSHAKE_TIMEOUT_MS = 30000

/** Full startup handshake for a fresh child: initialize, log the MCP wiring inputs, open a session.
 *  Returns { sessionId, models, loaded }. */
/** Cursor ACP advertises authMethods: ["cursor_login"] and requires an authenticate step before
 *  session/new — even when CURSOR_API_KEY is already in the env (the key just makes authenticate
 *  succeed without an interactive login). Other providers either skip authMethods or already have
 *  file/env creds the CLI reads on its own, so we only call authenticate when needed. */
function needsCursorAuth(kind, init) {
  if (kind === "cursor-cli") return true
  const methods = (init && (init.authMethods || init.authenticationMethods)) || []
  return Array.isArray(methods) && methods.some((m) => (m && (m.id || m.methodId || m)) === "cursor_login")
}

async function handshake(rpc, { kind, cwd, env = process.env, home, log = (m) => console.error(m) } = {}) {
  const init = await rpc.request("initialize", { protocolVersion: PROTOCOL_VERSION, clientCapabilities: CLIENT_CAPABILITIES }, HANDSHAKE_TIMEOUT_MS)
  const agentCapabilities = (init && init.agentCapabilities) || {}
  if (needsCursorAuth(kind, init)) {
    await rpc.request("authenticate", { methodId: "cursor_login" }, HANDSHAKE_TIMEOUT_MS)
  }
  // MCP wiring is silent by design (mcpServersFromEnv returns [] unless the agent advertised http
  // MCP), which makes "no oyren-mcp tools" impossible to diagnose from outside. Log the three inputs
  // so one boot distinguishes: agent lacks the capability vs. OYREN_MCP_SERVERS unset vs. passed fine.
  const mcpServers = mcpServersFromEnv(env, agentCapabilities)
  log(`[acp:${kind}] mcp: caps=${JSON.stringify(agentCapabilities.mcpCapabilities || null)} envSet=${!!env.OYREN_MCP_SERVERS} passed=${mcpServers.length}`)
  return openSession(rpc, { cwd, mcpServers, agentCapabilities, home, log: (m) => log(`[acp:${kind}] ${m}`) })
}

/** session/load the persisted id when the agent can, else session/new; persist the live id. */
async function openSession(rpc, { cwd, mcpServers = [], agentCapabilities, home, log = () => {} } = {}) {
  const persisted = acpSession.readSessionId(home)
  if (persisted && agentCapabilities && agentCapabilities.loadSession) {
    try {
      const loaded = await rpc.request("session/load", { sessionId: persisted, cwd, mcpServers }, HANDSHAKE_TIMEOUT_MS)
      return { sessionId: persisted, models: normalizeSessionModels(loaded), loaded: true }
    } catch (e) {
      log(`session/load of ${persisted} failed (${String((e && e.message) || e)}) — starting fresh`)
    }
  }
  const session = await rpc.request("session/new", { cwd, mcpServers }, HANDSHAKE_TIMEOUT_MS)
  const sessionId = (session && session.sessionId) || null
  if (sessionId) acpSession.writeSessionId(sessionId, home)
  return { sessionId, models: normalizeSessionModels(session), loaded: false }
}

module.exports = { handshake, openSession, needsCursorAuth, HANDSHAKE_TIMEOUT_MS }
