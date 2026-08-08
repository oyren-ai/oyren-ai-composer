const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { readSessionId, writeSessionId, sessionFile } = require("./acpSession")

test("the file lives in $HOME under the acp-specific name (never colliding with the SDK engine's)", () => {
  assert.equal(sessionFile("/home/oyren"), "/home/oyren/.oyren-acp-session")
})

test("session id round-trips through the home file; missing reads as null", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-acp-sess-"))
  assert.equal(readSessionId(home), null) // nothing persisted yet
  writeSessionId("acp-42", home)
  assert.equal(readSessionId(home), "acp-42")
})

test("an empty/whitespace file reads as null (never resume a blank id)", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-acp-sess-"))
  fs.writeFileSync(path.join(home, ".oyren-acp-session"), "  \n")
  assert.equal(readSessionId(home), null)
})

test("a write failure is swallowed (best-effort, never a crash)", () => {
  assert.doesNotThrow(() => writeSessionId("id", "/nonexistent-dir-oyren"))
})
