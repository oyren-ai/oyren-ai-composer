process.env.SESSION_TOKEN = "tok" // config reads this at require-time
const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path")
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-chat-"))
process.env.WORKING_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-chat-wd-")) // repo-less → no recovery preamble
// Running inside a real container these are set for real, and agentMeta would fetch the LIVE
// session's meta from the LIVE orchestrator — injecting a real recovery preamble into these tests.
for (const k of ["ORCHESTRATOR_URL", "OYREN_SESSION_SLUG", "CONTROL_TOKEN", "AGENT_META_B64"]) delete process.env[k]
const { test } = require("node:test")
const assert = require("node:assert")
const engine = require("./agentEngine")
const broadcast = require("./agentBroadcast")
const { handleAgentMessage, handleAgentCurrent, extractMessage } = require("./agentChat")
const { drive, makeFakeSdk, userLine } = require("./agentFakes")

const tick = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)) }
const url = (extra = "") => `/agent/message?token=tok${extra}`

test("extractMessage prefers the content-block array, falls back to a raw prompt, and rejects empties", () => {
  assert.deepEqual(extractMessage(Buffer.from(userLine("hi", "t1"))), { payload: [{ type: "text", text: "hi" }], turnId: "t1", clientMsgId: null, displayText: null })
  assert.deepEqual(extractMessage(Buffer.from("just text")), { payload: "just text", turnId: null, clientMsgId: null, displayText: null })
  assert.deepEqual(extractMessage(Buffer.from("")), { payload: null, turnId: null, clientMsgId: null })
})

test("extractMessage picks up client_msg_id + display_text used by the user-message echo", () => {
  const body = JSON.stringify({ type: "user", client_msg_id: "cm1", display_text: "hi", message: { content: [{ type: "text", text: "PREAMBLE\n\nhi" }] } })
  const got = extractMessage(Buffer.from(body))
  assert.equal(got.clientMsgId, "cm1")
  assert.equal(got.displayText, "hi")
})

test("POST without the session token is 401", async () => {
  const res = await drive(handleAgentMessage, { method: "POST", url: "/agent/message", body: userLine("hi") })
  assert.equal(res.status, 401)
})

test("an empty message is 400", async () => {
  const res = await drive(handleAgentMessage, { method: "POST", url: url(), body: "" })
  assert.equal(res.status, 400)
})

test("default POST is fire-and-forget: 202, session started, message injected", async () => {
  broadcast.reset(); const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  const res = await drive(handleAgentMessage, { method: "POST", url: url(), body: userLine("hi") })
  await tick()
  assert.equal(res.status, 202)
  assert.equal(sdk.calls.starts, 1)
  assert.deepEqual(sdk.inputs[0].message.content, [{ type: "text", text: "hi" }])
})

test("?follow=1 streams the session ndjson until the turn's result, then closes (loop compat)", async () => {
  broadcast.reset(); const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  const res = await drive(handleAgentMessage, { method: "POST", url: url("&follow=1"), body: userLine("go") })
  await tick()
  sdk.emit({ type: "assistant", session_id: "s1", message: { content: [{ type: "text", text: "yo" }] } })
  sdk.emit({ type: "result", subtype: "success", session_id: "s1" })
  await tick()
  assert.equal(res.status, 200)
  assert.match(res.body(), /"text":"yo"/)
  assert.match(res.body(), /"result"/)
  assert.equal(res.writableEnded, true) // ended on the result line
})

test("an empty message carrying a known turn_id replays that turn's buffer (loop reconcile)", async () => {
  broadcast.reset(); const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  await drive(handleAgentMessage, { method: "POST", url: url("&follow=1"), body: userLine("go", "t1") })
  await tick()
  sdk.emit({ type: "assistant", session_id: "s1", message: { content: [{ type: "text", text: "done" }] } })
  sdk.emit({ type: "result", subtype: "success", session_id: "s1" })
  await tick()
  // reconcile: same id, EMPTY text → replay, not re-run
  const res = await drive(handleAgentMessage, { method: "POST", url: url("&follow=1"), body: userLine("", "t1") })
  assert.equal(res.status, 200)
  assert.match(res.body(), /"text":"done"/)
  assert.equal(res.writableEnded, true)
})

test("an empty message with no turn_id is still 400; an unknown id replays as 409", async () => {
  broadcast.reset(); const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  assert.equal((await drive(handleAgentMessage, { method: "POST", url: url(), body: "" })).status, 400)
  assert.equal((await drive(handleAgentMessage, { method: "POST", url: url(), body: userLine("", "nope") })).status, 409)
})

test("a real POST echoes the user turn into the broadcast buffer (durable log gets user bubbles)", async () => {
  broadcast.reset(); const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  const body = JSON.stringify({ type: "user", client_msg_id: "cm1", message: { content: [{ type: "text", text: "hello" }] } })
  await drive(handleAgentMessage, { method: "POST", url: url(), body })
  await tick()
  const echo = broadcast.snapshot().map((l) => JSON.parse(l)).find((j) => j.type === "user_message")
  assert.ok(echo, "user_message echoed into the buffer")
  assert.equal(echo.id, "cm1")
  assert.deepEqual(echo.message.content, [{ type: "text", text: "hello" }])
})

test("display_text replaces the wire text in the echo (preamble never reaches replayed bubbles)", async () => {
  broadcast.reset(); const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" } }
  const body = JSON.stringify({ type: "user", client_msg_id: "cm2", display_text: "typed", message: { content: [image, { type: "text", text: "PREAMBLE\n\ntyped" }] } })
  await drive(handleAgentMessage, { method: "POST", url: url(), body })
  await tick()
  const echo = broadcast.snapshot().map((l) => JSON.parse(l)).find((j) => j.type === "user_message")
  assert.deepEqual(echo.message.content, [image, { type: "text", text: "typed" }])
})

test("a replay-only POST (empty text + known turn_id) does NOT echo a user_message", async () => {
  broadcast.reset(); const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  await drive(handleAgentMessage, { method: "POST", url: url("&follow=1"), body: userLine("go", "t9") })
  await tick()
  sdk.emit({ type: "result", subtype: "success", session_id: "s1" })
  await tick()
  const before = broadcast.snapshot().filter((l) => l.includes('"user_message"')).length
  await drive(handleAgentMessage, { method: "POST", url: url("&follow=1"), body: userLine("", "t9") })
  const after = broadcast.snapshot().filter((l) => l.includes('"user_message"')).length
  assert.equal(after, before)
})

test("GET /agent/current reports the live session state + this boot's id", async () => {
  broadcast.reset(); const sdk = makeFakeSdk(); engine.__setQueryImpl(sdk.query)
  await engine.send("hi")
  const res = await drive(handleAgentCurrent, { method: "GET", url: "/agent/current?token=tok" })
  assert.equal(res.status, 200)
  const body = JSON.parse(res.body())
  assert.equal(body.busy, true)
  assert.equal(body.bootId, broadcast.BOOT_ID) // lets a caller detect a container replacement
})
