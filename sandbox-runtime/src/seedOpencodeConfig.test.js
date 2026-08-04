const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { seedOpencodeConfig, opencodeConfig, bareModelId } = require("./seedOpencodeConfig")

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "oyren-opencode-"))
const configPath = (home) => path.join(home, ".config", "opencode", "opencode.json")
const readConfig = (home) => JSON.parse(fs.readFileSync(configPath(home), "utf8"))

test("bareModelId accepts both the orchestrator format and a raw catalog id", () => {
  assert.equal(bareModelId("openrouter/moonshotai/kimi-k3"), "moonshotai/kimi-k3")
  assert.equal(bareModelId("moonshotai/kimi-k3"), "moonshotai/kimi-k3")
  assert.equal(bareModelId("  openrouter/anthropic/claude-sonnet-4.6  "), "anthropic/claude-sonnet-4.6")
})

test("bareModelId rejects the retired dotted format and empty input rather than guessing a vendor", () => {
  assert.equal(bareModelId("openrouter.kimi-k2.5"), null)
  assert.equal(bareModelId(""), null)
  assert.equal(bareModelId(undefined), null)
})

test("writes the 1.17 schema: provider.options.apiKey, a model declaration, and a pinned model", () => {
  const config = opencodeConfig("openrouter/moonshotai/kimi-k3")
  assert.equal(config.$schema, "https://opencode.ai/config.json")
  assert.equal(config.provider.openrouter.options.apiKey, "{env:OPENROUTER_API_KEY}")
  // Declaring the model is what makes one opencode's bundled catalog doesn't know (Kimi K3) selectable.
  assert.deepEqual(config.provider.openrouter.models, { "moonshotai/kimi-k3": {} })
  assert.equal(config.model, "openrouter/moonshotai/kimi-k3")
  // The pre-1.0 keys are a hard config error for this CLI — they must never be emitted.
  assert.equal(config.providers, undefined)
  assert.equal(config.agents, undefined)
})

test("omits the model pin (but still wires the provider) when the model id is unusable", () => {
  const config = opencodeConfig("openrouter.kimi-k2.5")
  assert.equal(config.provider.openrouter.options.apiKey, "{env:OPENROUTER_API_KEY}")
  assert.equal(config.model, undefined)
  assert.equal(config.provider.openrouter.models, undefined)
})

test("drops legacy providers/agents keys left by an older image", () => {
  const home = tmpHome()
  fs.mkdirSync(path.dirname(configPath(home)), { recursive: true })
  fs.writeFileSync(configPath(home), JSON.stringify({ providers: { openrouter: { apiKey: "x" } }, agents: { coder: { model: "openrouter.old" } }, theme: "keep-me" }))
  seedOpencodeConfig(home, { OPENROUTER_API_KEY: "sk-or", OPENCODE_MODEL: "moonshotai/kimi-k3" })
  const config = readConfig(home)
  assert.equal(config.providers, undefined)
  assert.equal(config.agents, undefined)
  assert.equal(config.theme, "keep-me") // unrelated user keys still survive the merge
  assert.equal(config.model, "openrouter/moonshotai/kimi-k3")
})

test("is idempotent and a no-op without an OpenRouter key", () => {
  const home = tmpHome()
  const env = { OPENROUTER_API_KEY: "sk-or", OPENCODE_MODEL: "moonshotai/kimi-k3" }
  seedOpencodeConfig(home, env)
  const first = fs.readFileSync(configPath(home), "utf8")
  seedOpencodeConfig(home, env)
  assert.equal(fs.readFileSync(configPath(home), "utf8"), first)
  assert.equal(seedOpencodeConfig(tmpHome(), {}), false)
})
