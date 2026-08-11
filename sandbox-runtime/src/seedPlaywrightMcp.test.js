const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { seedPlaywrightMcp } = require("./seedPlaywrightMcp")

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "oyren-pw-home-"))
const EXPECTED = { type: "stdio", command: "playwright-mcp", args: ["--headless", "--browser", "chromium", "--no-sandbox"] }

test("writes the bundled playwright stdio entry into ~/.claude.json when the flag is on", () => {
  const home = tmpHome()
  assert.equal(seedPlaywrightMcp({ home, env: { OYREN_PLAYWRIGHT_MCP: "1" } }), true)
  const json = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"))
  assert.deepEqual(json.mcpServers.playwright, EXPECTED)
})

test("does nothing (writes no file) when the flag is absent, empty, or falsy", () => {
  for (const env of [{}, { OYREN_PLAYWRIGHT_MCP: "" }, { OYREN_PLAYWRIGHT_MCP: "0" }, { OYREN_PLAYWRIGHT_MCP: "false" }, { OYREN_PLAYWRIGHT_MCP: "off" }]) {
    const home = tmpHome()
    assert.equal(seedPlaywrightMcp({ home, env }), false)
    assert.equal(fs.existsSync(path.join(home, ".claude.json")), false)
  }
})

test("accepts common truthy spellings", () => {
  for (const value of ["true", "TRUE", "yes", "on", " 1 "]) {
    const home = tmpHome()
    assert.equal(seedPlaywrightMcp({ home, env: { OYREN_PLAYWRIGHT_MCP: value } }), true)
  }
})

test("merges into an existing config, preserving unrelated keys and other servers", () => {
  const home = tmpHome()
  fs.writeFileSync(
    path.join(home, ".claude.json"),
    JSON.stringify({ oauthAccount: "keep", mcpServers: { context7: { type: "http", url: "https://mcp.context7.com/mcp" } } }),
  )
  assert.equal(seedPlaywrightMcp({ home, env: { OYREN_PLAYWRIGHT_MCP: "1" } }), true)
  const json = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"))
  assert.equal(json.oauthAccount, "keep")
  assert.ok(json.mcpServers.context7)
  assert.deepEqual(json.mcpServers.playwright, EXPECTED)
})

test("never clobbers a different existing `playwright` key — suffixes ours instead", () => {
  const home = tmpHome()
  const theirs = { type: "http", url: "https://example.com/playwright-mcp" }
  fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { playwright: theirs } }))
  assert.equal(seedPlaywrightMcp({ home, env: { OYREN_PLAYWRIGHT_MCP: "1" } }), true)
  const json = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"))
  assert.deepEqual(json.mcpServers.playwright, theirs) // untouched
  assert.deepEqual(json.mcpServers["playwright-2"], EXPECTED)
})

test("re-run is idempotent: our existing entry is reused, not duplicated", () => {
  const home = tmpHome()
  const env = { OYREN_PLAYWRIGHT_MCP: "1" }
  seedPlaywrightMcp({ home, env })
  assert.equal(seedPlaywrightMcp({ home, env }), true)
  const json = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"))
  assert.deepEqual(Object.keys(json.mcpServers), ["playwright"])
})

test("starts fresh over an unparseable existing file instead of throwing", () => {
  const home = tmpHome()
  fs.writeFileSync(path.join(home, ".claude.json"), "not-json")
  assert.equal(seedPlaywrightMcp({ home, env: { OYREN_PLAYWRIGHT_MCP: "1" } }), true)
  const json = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"))
  assert.deepEqual(json.mcpServers.playwright, EXPECTED)
})
