// opencode's ~/.config/opencode/opencode.json: wire the oyren/BYOK OpenRouter key as a provider and
// pin the model the launch selected. The `{env:...}` placeholder keeps the secret out of the file.
//
// SCHEMA WARNING: this must track the opencode the image installs (opencode-ai@1.17.x, the Bun/TS
// rewrite), NOT the archived Go opencode-ai/opencode. They share a config filename and nothing else:
// the Go one took `providers.openrouter.apiKey` + `agents.coder.model`, and feeding those to the
// current CLI is a HARD failure ("Configuration is invalid ... Unrecognized keys: providers, agents"),
// which takes down `opencode acp` before a single prompt is served. Current shape:
//   { provider: { openrouter: { options: { apiKey }, models: {...} } }, model: "openrouter/<id>" }
const path = require("path")
const { mergeJsonFile } = require("./secretFiles")

const SCHEMA = "https://opencode.ai/config.json"
const PROVIDER = "openrouter"
// Keys written by the pre-1.0 schema. Merging leaves them in place, and their mere presence keeps the
// file invalid — so a container that ever seeded them must actively drop them on the next boot.
const LEGACY_KEYS = ["providers", "agents"]

/**
 * The bare OpenRouter catalog id (`moonshotai/kimi-k3`) from whatever OPENCODE_MODEL carries, or null
 * when it can't be recovered. Accepts the current orchestrator format (`openrouter/moonshotai/kimi-k3`)
 * and a raw catalog id, so the container and the orchestrator can be deployed in either order.
 * The retired format (`openrouter.kimi-k3`) threw the vendor away and is unreconstructable — return
 * null and let opencode choose its own default rather than pin a model that resolves to nothing.
 */
function bareModelId(raw) {
  const value = String(raw || "").trim()
  if (!value) return null
  const stripped = value.startsWith(`${PROVIDER}/`) ? value.slice(PROVIDER.length + 1) : value
  return stripped.includes("/") ? stripped : null
}

/** The config body for a given key/model, split out so tests can assert the shape without touching disk. */
function opencodeConfig(modelEnv) {
  const config = { $schema: SCHEMA, provider: { [PROVIDER]: { options: { apiKey: "{env:OPENROUTER_API_KEY}" } } } }
  const bare = bareModelId(modelEnv)
  if (bare) {
    // Declaring the model is what makes one opencode's bundled models.dev catalog doesn't know yet
    // (e.g. Kimi K3) selectable at all; an empty object is enough, and it's a harmless no-op for the
    // models already in the catalog.
    config.provider[PROVIDER].models = { [bare]: {} }
    config.model = `${PROVIDER}/${bare}`
  }
  return config
}

/** Seed the config when an OpenRouter key is present; a silent no-op otherwise. Returns whether it wrote. */
function seedOpencodeConfig(home, env) {
  if (!env.OPENROUTER_API_KEY) return false
  mergeJsonFile(path.join(home, ".config", "opencode", "opencode.json"), opencodeConfig(env.OPENCODE_MODEL), LEGACY_KEYS)
  return true
}

module.exports = { seedOpencodeConfig, opencodeConfig, bareModelId }
