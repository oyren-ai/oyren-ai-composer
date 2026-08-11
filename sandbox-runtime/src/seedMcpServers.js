const fs = require("fs")
const path = require("path")

/** Slugify a server name into a safe, unique mcpServers key. */
function keyFor(name, used) {
  const base = String(name || "oyren").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "oyren"
  let key = base
  let i = 2
  while (used.has(key)) key = `${base}-${i++}`
  used.add(key)
  return key
}

/**
 * When OYREN_MCP_SERVERS (JSON array of {name,url,token?}, injected by the orchestrator) is present,
 * merge each into ~/.claude.json under `mcpServers` as an HTTP server so the first interactive
 * `claude` can call it with no manual setup. `token` is optional — some legitimate remote MCP servers
 * (e.g. Context7's public endpoint) require no auth at all; when absent we seed the server with no
 * Authorization header instead of skipping it. Idempotent + best-effort: merges into any existing
 * config, never clobbers other keys, and a read/write/parse failure must never crash boot (the
 * caller swallows throws).
 */
function seedMcpServers({ home = process.env.HOME || "/home/oyren", env = process.env } = {}) {
  const raw = env.OYREN_MCP_SERVERS
  if (!raw) return false
  let servers
  try {
    servers = JSON.parse(raw)
  } catch {
    return false
  }
  if (!Array.isArray(servers) || servers.length === 0) return false

  const file = path.join(home, ".claude.json")
  let current = {}
  try {
    current = JSON.parse(fs.readFileSync(file, "utf8")) || {}
  } catch {
    current = {} // no file yet (or unreadable) → start fresh
  }

  const mcpServers = { ...(current.mcpServers || {}) }
  const used = new Set(Object.keys(mcpServers))
  let added = 0
  for (const s of servers) {
    if (!s || !s.url) continue
    mcpServers[keyFor(s.name, used)] = {
      type: "http",
      url: s.url,
      ...(s.token ? { headers: { Authorization: `Bearer ${s.token}` } } : {}),
    }
    added++
  }
  if (added === 0) return false
  fs.writeFileSync(file, JSON.stringify({ ...current, mcpServers }, null, 2))
  return true
}

module.exports = { seedMcpServers }
