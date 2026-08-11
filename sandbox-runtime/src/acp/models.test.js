const { test } = require("node:test")
const assert = require("node:assert")
const { fallbackModels, resolveModels, currentModel, normalizeSessionModels } = require("./models")

test("normalizeSessionModels reads opencode's configOptions shape (it reports no `models` at all)", () => {
  const session = {
    sessionId: "ses_1",
    configOptions: [{ id: "model", type: "select", currentValue: "openrouter/moonshotai/kimi-k3", options: [{ value: "openrouter/moonshotai/kimi-k3", name: "Kimi K3" }] }],
  }
  const models = normalizeSessionModels(session)
  assert.equal(currentModel(models), "openrouter/moonshotai/kimi-k3")
  assert.deepEqual(resolveModels("opencode", models), [{ value: "openrouter/moonshotai/kimi-k3", displayName: "Kimi K3" }])
})

test("normalizeSessionModels prefers a native `models` payload and tolerates neither being present", () => {
  assert.deepEqual(normalizeSessionModels({ models: { currentModelId: "m1" } }), { currentModelId: "m1" })
  assert.equal(normalizeSessionModels({ sessionId: "s" }), null)
  assert.equal(normalizeSessionModels(null), null)
})

test("every ACP provider has a static fallback shape the models endpoint can serve", () => {
  for (const kind of ["codex-cli", "gemini-cli", "qwen-code", "cursor-cli", "antigravity-cli"]) {
    const models = fallbackModels(kind)
    assert.ok(models.length > 0, `${kind} should have fallback models`)
    assert.ok(models.every((m) => m.value && m.displayName)) // the {value, displayName} shape the picker renders
  }
  assert.deepEqual(fallbackModels("unknown-kind"), []) // unknown kinds degrade to empty, never throw
})

test("session-reported models are preferred over the static list", () => {
  const session = { currentModelId: "m2", availableModels: [{ modelId: "m1", name: "One" }, { modelId: "m2" }] }
  assert.deepEqual(resolveModels("codex-cli", session), [
    { value: "m1", displayName: "One" },
    { value: "m2", displayName: "m2" }, // name missing → id doubles as the display name
  ])
  assert.equal(currentModel(session), "m2")
})

test("junk session shapes fall back to the static list (never throw)", () => {
  assert.deepEqual(resolveModels("qwen-code", null), fallbackModels("qwen-code"))
  assert.deepEqual(resolveModels("qwen-code", { availableModels: "nope" }), fallbackModels("qwen-code"))
  assert.deepEqual(resolveModels("qwen-code", { availableModels: [{}] }), fallbackModels("qwen-code"))
  assert.equal(currentModel(null, "kept"), "kept")
  assert.equal(currentModel({}, null), null)
})
