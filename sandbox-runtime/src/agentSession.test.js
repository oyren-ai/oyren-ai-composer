const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { readSessionId, writeSessionId, extractSessionId, buildArgs } = require("./agentSession")

test("extractSessionId reads the id off a system event only", () => {
  assert.equal(extractSessionId(JSON.stringify({ type: "system", subtype: "init", session_id: "abc" })), "abc")
  assert.equal(extractSessionId(JSON.stringify({ type: "assistant", session_id: "x" })), null) // not a system event
  assert.equal(extractSessionId('{"type":"system"'), null) // partial / non-JSON
  assert.equal(extractSessionId("plain text"), null)
})

test("buildArgs is one-shot stream-json, and appends --resume only with an id", () => {
  assert.deepEqual(buildArgs("hi", null), ["-p", "hi", "--output-format", "stream-json", "--include-partial-messages", "--verbose"])
  const withResume = buildArgs("hi", "sess-1")
  assert.equal(withResume.includes("--resume"), true)
  assert.equal(withResume[withResume.indexOf("--resume") + 1], "sess-1")
})

test("buildArgs appends --model only when a model is given", () => {
  const withModel = buildArgs("hi", null, "opus")
  assert.equal(withModel.includes("--model"), true)
  assert.equal(withModel[withModel.indexOf("--model") + 1], "opus")
  assert.equal(buildArgs("hi", null, undefined).includes("--model"), false) // no model → no flag
  assert.equal(buildArgs("hi", null, "").includes("--model"), false) // empty string → no flag
})

test("session id round-trips through the home file; missing reads as null", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-agent-"))
  assert.equal(readSessionId(home), null) // nothing written yet
  writeSessionId("sess-42", home)
  assert.equal(readSessionId(home), "sess-42")
})
