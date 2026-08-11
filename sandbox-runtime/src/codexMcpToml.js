// Merge the orchestrator's OYREN_MCP_SERVERS (JSON array of {name,url,token} — the SAME format
// seedMcpServers.js and acp/mcpServers.js consume) into Codex's ~/.codex/config.toml as streamable
// HTTP MCP servers, so the `codex` TUI (and the codex-acp bridge, which reads codex config) discover
// oyren-mcp with no manual setup — the Codex analog of the ~/.claude.json seed.
//
// Codex schema (codex-rs/config/src/mcp_types.rs): StreamableHttp takes { url, http_headers, ... } and
// EXPLICITLY REJECTS an inline `bearer_token` key, so we pass the token via `http_headers.Authorization`
// (inline, self-contained — mirrors the Bearer header the other two paths send). Streamable HTTP MCP is
// gated behind the top-level `experimental_use_rmcp_client` flag in this Codex era, so we ensure it is on.

/** Slugify a server name into a safe, unique bare TOML table key ([a-z0-9-] is valid unquoted). */
function keyFor(name, used) {
  const base = String(name || "oyren").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "oyren"
  let key = base
  let i = 2
  while (used.has(key)) key = `${base}-${i++}`
  used.add(key)
  return key
}

/** A TOML basic string: wrap in quotes, escaping backslash and double-quote. */
const tomlStr = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`

/**
 * Return `base` config.toml augmented with an [mcp_servers.*] block per valid oyren server. When there
 * are none, `base` is returned untouched. Never throws: a missing/malformed OYREN_MCP_SERVERS degrades
 * to `base` (an unparsable value must not corrupt Codex's config or crash boot).
 */
function mergeCodexMcp(base = "", env = process.env) {
  let servers
  try { servers = JSON.parse(env.OYREN_MCP_SERVERS || "[]") } catch { return base }
  if (!Array.isArray(servers)) return base
  const valid = servers.filter((s) => s && s.url && s.token)
  if (valid.length === 0) return base

  const used = new Set()
  const blocks = valid.map((s) => {
    const key = keyFor(s.name, used)
    return `[mcp_servers.${key}]\nurl = ${tomlStr(s.url)}\nhttp_headers = { Authorization = ${tomlStr(`Bearer ${s.token}`)} }\n`
  })

  // The flag is a top-level key, so it must precede any [table] header — prepend it (unless already set).
  const flag = /^\s*experimental_use_rmcp_client\s*=/m.test(base) ? "" : "experimental_use_rmcp_client = true\n"
  const head = base ? (base.endsWith("\n") ? base : `${base}\n`) : ""
  return `${flag}${head ? `\n${head}` : ""}\n${blocks.join("\n")}`.replace(/^\n+/, "")
}

module.exports = { mergeCodexMcp }
