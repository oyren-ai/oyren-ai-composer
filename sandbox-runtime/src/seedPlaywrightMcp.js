const fs = require("fs")
const path = require("path")

// Mirrors the official playwright-mcp Docker entrypoint flags: headless chromium with the OS sandbox
// off — this container runs as a single non-root user and is itself the isolation boundary (and the
// chromium sandbox needs user namespaces the runtime may not grant).
const ENTRY = {
  type: "stdio",
  command: "playwright-mcp", // global bin from @playwright/mcp, baked into oyren-sandbox-claude
  args: ["--headless", "--browser", "chromium", "--no-sandbox"],
}

const TRUTHY = new Set(["1", "true", "yes", "on"])

/**
 * When OYREN_PLAYWRIGHT_MCP (an on/off flag injected by the orchestrator — the bundled Playwright MCP
 * is a LOCAL stdio process, so unlike OYREN_MCP_SERVERS there is no URL/token to carry) is truthy,
 * merge a `playwright` stdio entry into ~/.claude.json `mcpServers` pointing at the image-bundled
 * `playwright-mcp` CLI. Additive: an existing different `playwright` key (e.g. a user's remote server
 * seeded by seedMcpServers) is kept and ours gets a `-2` style suffix; a re-run that finds our exact
 * entry is a no-op (idempotent). Best-effort like the other seeds: never throws across boot.
 */
function seedPlaywrightMcp({ home = process.env.HOME || "/home/oyren", env = process.env } = {}) {
  const flag = String(env.OYREN_PLAYWRIGHT_MCP || "").trim().toLowerCase()
  if (!TRUTHY.has(flag)) return false

  const file = path.join(home, ".claude.json")
  let current = {}
  try {
    current = JSON.parse(fs.readFileSync(file, "utf8")) || {}
  } catch {
    current = {} // no file yet (or unreadable) → start fresh
  }

  const mcpServers = { ...(current.mcpServers || {}) }
  let key = "playwright"
  for (let i = 2; mcpServers[key]; i++) {
    if (JSON.stringify(mcpServers[key]) === JSON.stringify(ENTRY)) return true // already seeded
    key = `playwright-${i}`
  }
  mcpServers[key] = ENTRY
  fs.writeFileSync(file, JSON.stringify({ ...current, mcpServers }, null, 2))
  return true
}

module.exports = { seedPlaywrightMcp }
