const { test } = require("node:test")
const assert = require("node:assert")
const { filterEnv, ALLOWED_KEYS } = require("./claudeEnvAllowlist")

// Every var the design plan explicitly says must NEVER reach a wrapped claude child.
const FORBIDDEN = [
  "AGENT_SIDE_AUTH_B64",
  "GITHUB_TOKEN",
  "OYREN_MCP_SERVERS",
  "CONTROL_TOKEN",
  "SESSION_TOKEN",
  "CONTAINER_ENV_B64",
  "SOME_FUTURE_SECRET_NOBODY_ALLOWLISTED",
]

test("no forbidden/unlisted key survives filterEnv, even when present in the source env", () => {
  const fakeEnv = {}
  for (const key of FORBIDDEN) fakeEnv[key] = "leak-me-and-fail-the-test"
  for (const key of ALLOWED_KEYS) fakeEnv[key] = `ok-${key}`
  const out = filterEnv(fakeEnv)
  for (const key of FORBIDDEN) assert.equal(key in out, false, `${key} must not be forwarded`)
})

test("every allowlisted key present in the source env is forwarded byte-exact", () => {
  const fakeEnv = {}
  for (const key of ALLOWED_KEYS) fakeEnv[key] = `value-for-${key}`
  const out = filterEnv(fakeEnv)
  for (const key of ALLOWED_KEYS) assert.equal(out[key], `value-for-${key}`)
  assert.equal(Object.keys(out).length, ALLOWED_KEYS.size)
})

test("an allowlisted key simply absent from the source env is absent from the output, not undefined-filled", () => {
  const out = filterEnv({ PATH: "/bin" })
  assert.equal(out.PATH, "/bin")
  assert.equal("HOME" in out, false)
  assert.equal(Object.keys(out).length, 1)
})

test("the real process.env (this test process) never leaks anything outside the allowlist", () => {
  const out = filterEnv(process.env)
  for (const key of Object.keys(out)) assert.ok(ALLOWED_KEYS.has(key), `${key} leaked past the allowlist`)
})
