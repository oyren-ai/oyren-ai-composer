const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { seedAgentAuth } = require("./seedAgentAuth")

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "oyren-agent-home-"))
const b64 = (s) => Buffer.from(s, "utf8").toString("base64")
const mode = (p) => fs.statSync(p).mode & 0o777

test("does nothing (writes no file) without any provider env vars", () => {
  const home = tmpHome()
  assert.equal(seedAgentAuth({ home, env: {} }), false)
  assert.deepEqual(fs.readdirSync(home), [])
})

test("codex: seeds ~/.codex/auth.json and config.toml from the B64 vars, both 0600", () => {
  const home = tmpHome()
  const env = { CODEX_AUTH_JSON_B64: b64('{"tokens":{"access_token":"at"}}'), CODEX_CONFIG_TOML_B64: b64("[model_providers.openrouter]\n") }
  assert.equal(seedAgentAuth({ home, env }), true)
  const authPath = path.join(home, ".codex", "auth.json")
  assert.equal(JSON.parse(fs.readFileSync(authPath, "utf8")).tokens.access_token, "at")
  assert.equal(mode(authPath), 0o600)
  const tomlPath = path.join(home, ".codex", "config.toml")
  assert.match(fs.readFileSync(tomlPath, "utf8"), /model_providers\.openrouter/)
  assert.equal(mode(tomlPath), 0o600)
})

test("codex: OYREN_MCP_SERVERS alone seeds config.toml with an mcp_servers block (no CODEX_CONFIG_TOML_B64)", () => {
  const home = tmpHome()
  const env = { OYREN_MCP_SERVERS: JSON.stringify([{ name: "workspace", url: "https://mcp.oyren.ai/x", token: "tk" }]) }
  assert.equal(seedAgentAuth({ home, env }), true)
  const toml = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8")
  assert.match(toml, /\[mcp_servers\.workspace\]/)
  assert.match(toml, /http_headers = \{ Authorization = "Bearer tk" \}/)
  assert.equal(mode(path.join(home, ".codex", "config.toml")), 0o600)
})

test("gemini subscription: seeds oauth_creds.json (0600) and pins selectedAuthType oauth-personal", () => {
  const home = tmpHome()
  seedAgentAuth({ home, env: { GEMINI_OAUTH_CREDS_B64: b64('{"access_token":"g"}') } })
  const credsPath = path.join(home, ".gemini", "oauth_creds.json")
  assert.equal(JSON.parse(fs.readFileSync(credsPath, "utf8")).access_token, "g")
  assert.equal(mode(credsPath), 0o600)
  const settings = JSON.parse(fs.readFileSync(path.join(home, ".gemini", "settings.json"), "utf8"))
  assert.equal(settings.selectedAuthType, "oauth-personal")
  assert.equal(settings.security.auth.selectedType, "oauth-personal") // v2 settings path too
})

test("gemini byok: GEMINI_API_KEY alone pins gemini-api-key and writes NO creds file", () => {
  const home = tmpHome()
  seedAgentAuth({ home, env: { GEMINI_API_KEY: "AIza-x" } })
  assert.equal(fs.existsSync(path.join(home, ".gemini", "oauth_creds.json")), false)
  const settings = JSON.parse(fs.readFileSync(path.join(home, ".gemini", "settings.json"), "utf8"))
  assert.equal(settings.selectedAuthType, "gemini-api-key")
})

test("gemini settings merge preserves existing keys (idempotent re-runs included)", () => {
  const home = tmpHome()
  fs.mkdirSync(path.join(home, ".gemini"), { recursive: true })
  fs.writeFileSync(path.join(home, ".gemini", "settings.json"), JSON.stringify({ theme: "keep-me", security: { auth: { other: true } } }))
  seedAgentAuth({ home, env: { GEMINI_API_KEY: "AIza-x" } })
  seedAgentAuth({ home, env: { GEMINI_API_KEY: "AIza-x" } }) // second run must not corrupt anything
  const settings = JSON.parse(fs.readFileSync(path.join(home, ".gemini", "settings.json"), "utf8"))
  assert.equal(settings.theme, "keep-me")
  assert.equal(settings.security.auth.other, true) // deep keys survive the deep merge
  assert.equal(settings.security.auth.selectedType, "gemini-api-key")
})

// opencode is dispatched to seedOpencodeConfig — one case here to prove the wiring, the schema
// details live in seedOpencodeConfig.test.js.
test("opencode: dispatched from seedAgentAuth, secret stays in the env, file is 0600", () => {
  const home = tmpHome()
  assert.equal(seedAgentAuth({ home, env: { OPENROUTER_API_KEY: "sk-or-secret", OPENCODE_MODEL: "openrouter/moonshotai/kimi-k3" } }), true)
  const file = path.join(home, ".config", "opencode", "opencode.json")
  const config = JSON.parse(fs.readFileSync(file, "utf8"))
  assert.equal(config.provider.openrouter.options.apiKey, "{env:OPENROUTER_API_KEY}")
  assert.ok(!fs.readFileSync(file, "utf8").includes("sk-or-secret")) // the secret stays in the env
  assert.equal(mode(file), 0o600)
})
