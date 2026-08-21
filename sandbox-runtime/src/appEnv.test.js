const { test } = require("node:test")
const assert = require("node:assert")
const { appEnv, DENYLIST } = require("./appEnv")

test("appEnv scrubs session-control secrets but keeps the rest of the environment", () => {
  const base = {
    SESSION_TOKEN: "s",
    CONTROL_TOKEN: "c",
    GITHUB_TOKEN: "g",
    ANTHROPIC_API_KEY: "user-key",
    PORT: "1",
    PATH: "/usr/bin",
  }
  const env = appEnv(base)
  for (const key of DENYLIST) assert.equal(env[key], undefined, `${key} must be scrubbed`)
  assert.equal(env.ANTHROPIC_API_KEY, "user-key")
  assert.equal(env.PORT, "1")
  assert.equal(env.PATH, "/usr/bin")
  // the base object must not be mutated
  assert.equal(base.SESSION_TOKEN, "s")
})

test("appEnv defaults to a scrubbed copy of process.env", () => {
  process.env.SESSION_TOKEN = "s"
  process.env.CONTROL_TOKEN = "c"
  try {
    const env = appEnv()
    assert.equal(env.SESSION_TOKEN, undefined)
    assert.equal(env.CONTROL_TOKEN, undefined)
    assert.equal(process.env.SESSION_TOKEN, "s")
  } finally {
    delete process.env.SESSION_TOKEN
    delete process.env.CONTROL_TOKEN
  }
})