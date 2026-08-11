// OYREN_MCP_SERVERS (JSON array of {name,url,token}, injected by the orchestrator — the SAME format
// seedMcpServers.js consumes for ~/.claude.json) → the ACP `session/new` mcpServers list. HTTP MCP is
// an OPTIONAL agent capability, so the caller passes the initialize response's agentCapabilities and
// we return [] unless the agent advertised mcpCapabilities.http — sending unsupported servers would
// fail session/new outright on some CLIs. Parse failures degrade to [] (never crash a session start).
function mcpServersFromEnv(env = process.env, agentCapabilities = null) {
  if (!agentCapabilities || !agentCapabilities.mcpCapabilities || !agentCapabilities.mcpCapabilities.http) return []
  let servers
  try { servers = JSON.parse(env.OYREN_MCP_SERVERS || "[]") } catch { return [] }
  if (!Array.isArray(servers)) return []
  return servers
    .filter((s) => s && s.url && s.token)
    .map((s) => ({ type: "http", name: String(s.name || "oyren"), url: s.url, headers: [{ name: "Authorization", value: `Bearer ${s.token}` }] }))
}

module.exports = { mcpServersFromEnv }
