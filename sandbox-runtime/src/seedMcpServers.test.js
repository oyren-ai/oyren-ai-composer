const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { seedMcpServers } = require("./seedMcpServers")

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "oyren-mcp-home-"))
const servers = (arr) => JSON.stringify(arr)

test("writes each server into ~/.claude.json mcpServers as an HTTP server with a bearer header", () => {
  const home = tmpHome()
  const ok = seedMcpServers({
    home,
    env: { OYREN_MCP_SERVERS: servers([{ name: "oyren-ai-workspace-mcp", url: "https://oyren.ai/api/mcp/srv-1", token: "oyrmcp_x" }]) },
  })
  assert.equal(ok, true)
  const json = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"))
  assert.deepEqual(json.mcpServers["oyren-ai-workspace-mcp"], {
    type: "http",
    url: "https://oyren.ai/api/mcp/srv-1",
    headers: { Authorization: "Bearer oyrmcp_x" },
  })
})

test("does nothing (writes no file) when OYREN_MCP_SERVERS is absent or empty", () => {
  const a = tmpHome()
  assert.equal(seedMcpServers({ home: a, env: {} }), false)
  assert.equal(fs.existsSync(path.join(a, ".claude.json")), false)
  const b = tmpHome()
  assert.equal(seedMcpServers({ home: b, env: { OYREN_MCP_SERVERS: "[]" } }), false)
})

test("writes a server with no token and no Authorization header (e.g. an unauthenticated public MCP)", () => {
  const home = tmpHome()
  const ok = seedMcpServers({
    home,
    env: { OYREN_MCP_SERVERS: servers([{ name: "context7", url: "https://mcp.context7.com/mcp" }]) },
  })
  assert.equal(ok, true)
  const json = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"))
  assert.deepEqual(json.mcpServers.context7, { type: "http", url: "https://mcp.context7.com/mcp" })
})

test("returns false on malformed JSON or all-invalid entries, never throwing", () => {
  const a = tmpHome()
  assert.equal(seedMcpServers({ home: a, env: { OYREN_MCP_SERVERS: "not-json" } }), false)
  const b = tmpHome()
  assert.equal(seedMcpServers({ home: b, env: { OYREN_MCP_SERVERS: servers([{ name: "x" }]) } }), false) // no url
})

test("merges into an existing config and de-duplicates colliding keys", () => {
  const home = tmpHome()
  fs.writeFileSync(
    path.join(home, ".claude.json"),
    JSON.stringify({ oauthAccount: "keep", mcpServers: { project: { type: "http", url: "u", headers: {} } } }),
  )
  seedMcpServers({
    home,
    env: { OYREN_MCP_SERVERS: servers([{ name: "Project", url: "https://o/api/mcp/s2", token: "t2" }]) },
  })
  const json = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"))
  assert.equal(json.oauthAccount, "keep") // unrelated key preserved
  assert.ok(json.mcpServers.project) // existing server preserved
  assert.equal(json.mcpServers["project-2"].url, "https://o/api/mcp/s2") // collision → suffixed key
})
