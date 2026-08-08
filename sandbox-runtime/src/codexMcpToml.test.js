const { test } = require("node:test")
const assert = require("node:assert")
const { mergeCodexMcp } = require("./codexMcpToml")

const SERVERS = JSON.stringify([{ name: "workspace files", url: "https://mcp.oyren.ai/x", token: "tk" }])

test("no OYREN_MCP_SERVERS → base returned untouched", () => {
  assert.equal(mergeCodexMcp("[model_providers.openrouter]\n", {}), "[model_providers.openrouter]\n")
})

test("malformed / non-array OYREN_MCP_SERVERS degrades to base (never throws)", () => {
  assert.equal(mergeCodexMcp("base\n", { OYREN_MCP_SERVERS: "{not json" }), "base\n")
  assert.equal(mergeCodexMcp("base\n", { OYREN_MCP_SERVERS: '{"a":1}' }), "base\n")
})

test("servers missing url or token are skipped; all-invalid ⇒ base", () => {
  const env = { OYREN_MCP_SERVERS: JSON.stringify([{ name: "x", url: "https://u" }, { name: "y", token: "t" }]) }
  assert.equal(mergeCodexMcp("base\n", env), "base\n")
})

test("appends a streamable-HTTP block with the Bearer header and enables rmcp", () => {
  const out = mergeCodexMcp("[model_providers.openrouter]\n", { OYREN_MCP_SERVERS: SERVERS })
  assert.match(out, /^experimental_use_rmcp_client = true/) // top-level flag before any table
  assert.match(out, /model_providers\.openrouter/) // base preserved
  assert.match(out, /\[mcp_servers\.workspace-files\]/) // name slugified to a bare key
  assert.match(out, /url = "https:\/\/mcp\.oyren\.ai\/x"/)
  assert.match(out, /http_headers = \{ Authorization = "Bearer tk" \}/) // NOT an inline bearer_token (Codex rejects it)
  assert.doesNotMatch(out, /bearer_token =/)
})

test("does not duplicate the rmcp flag when the base already sets it", () => {
  const out = mergeCodexMcp("experimental_use_rmcp_client = true\n", { OYREN_MCP_SERVERS: SERVERS })
  assert.equal(out.match(/experimental_use_rmcp_client/g).length, 1)
})

test("empty base + servers ⇒ flag first, no leading blank lines", () => {
  const out = mergeCodexMcp("", { OYREN_MCP_SERVERS: SERVERS })
  assert.ok(out.startsWith("experimental_use_rmcp_client = true"))
})

test("duplicate server names get unique table keys", () => {
  const env = { OYREN_MCP_SERVERS: JSON.stringify([{ name: "ws", url: "https://a", token: "1" }, { name: "ws", url: "https://b", token: "2" }]) }
  const out = mergeCodexMcp("", env)
  assert.match(out, /\[mcp_servers\.ws\]/)
  assert.match(out, /\[mcp_servers\.ws-2\]/)
})
