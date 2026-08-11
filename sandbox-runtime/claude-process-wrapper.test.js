const { test } = require("node:test")
const assert = require("node:assert")
const { deriveSessionKey } = require("./claude-process-wrapper")

test("no recognizable id in argv falls back to the well-known default key", () => {
  assert.equal(deriveSessionKey([]), "default")
  assert.equal(deriveSessionKey(["--some-other-flag", "x"]), "default")
})

test("--session-id <id> is used as the session key", () => {
  assert.equal(deriveSessionKey(["--session-id", "abc-123"]), "abc-123")
})

test("--resume <id> is used as the session key", () => {
  assert.equal(deriveSessionKey(["--resume", "resumed-session"]), "resumed-session")
})

test("a flag with no following value falls back rather than picking up the next flag as the id", () => {
  assert.equal(deriveSessionKey(["--session-id"]), "default")
})
