const { test } = require("node:test")
const assert = require("node:assert")
const { createTurnState } = require("./claudeWrapperTurnState")

const line = (obj) => Buffer.from(JSON.stringify(obj) + "\n")

test("session id is captured from stdout's system:init line", () => {
  const ts = createTurnState()
  assert.equal(ts.getSessionId(), null)
  ts.feedStdout(line({ type: "system", subtype: "init", session_id: "sid-1" }))
  assert.equal(ts.getSessionId(), "sid-1")
})

test("a system:init split across arbitrary chunk boundaries still parses", () => {
  const ts = createTurnState()
  const bytes = line({ type: "system", subtype: "init", session_id: "sid-chunked" })
  for (const b of bytes) ts.feedStdout(Buffer.from([b]))
  assert.equal(ts.getSessionId(), "sid-chunked")
})

test("busy flips on a stdin user message and off on a stdout result", () => {
  const ts = createTurnState()
  assert.equal(ts.isBusy(), false)
  ts.feedStdin(line({ type: "user", message: { role: "user", content: [] } }))
  assert.equal(ts.isBusy(), true)
  ts.feedStdout(line({ type: "assistant", message: {} }))
  assert.equal(ts.isBusy(), true, "an assistant line is mid-turn, not the end of it")
  ts.feedStdout(line({ type: "result", subtype: "success" }))
  assert.equal(ts.isBusy(), false)
})

test("control_request traffic on stdin never opens a turn — only user messages do", () => {
  const ts = createTurnState()
  ts.feedStdin(line({ type: "control_request", request: { subtype: "initialize" } }))
  assert.equal(ts.isBusy(), false)
})

test("onceResult fires exactly once, on the NEXT result only", () => {
  const ts = createTurnState()
  let fired = 0
  ts.onceResult(() => { fired += 1 })
  ts.feedStdout(line({ type: "result" }))
  ts.feedStdout(line({ type: "result" }))
  assert.equal(fired, 1)
})

test("non-JSON and partial lines are ignored without disturbing state", () => {
  const ts = createTurnState()
  ts.feedStdin(Buffer.from("garbage that is not json\n"))
  ts.feedStdout(Buffer.from("more garbage\n{\"type\":\"sys"))
  assert.equal(ts.isBusy(), false)
  assert.equal(ts.getSessionId(), null)
  ts.feedStdout(Buffer.from('tem","subtype":"init","session_id":"after-garbage"}\n'))
  assert.equal(ts.getSessionId(), "after-garbage")
})

test("an absurdly long unterminated line is dropped instead of growing forever", () => {
  const ts = createTurnState()
  ts.feedStdout(Buffer.alloc(2 * 1024 * 1024, 0x61)) // 2MB of 'a', no newline
  ts.feedStdout(Buffer.from('\n{"type":"system","subtype":"init","session_id":"survives"}\n'))
  assert.equal(ts.getSessionId(), "survives", "scanning must recover on the next real line")
})
