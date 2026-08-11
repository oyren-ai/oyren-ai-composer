// Golden cases per the ACP → stream-json mapping table: the frontend transcript reducer must be able
// to consume every emitted line unchanged, so these assert the exact wire shapes.
const { test } = require("node:test")
const assert = require("node:assert")
const { createState, beginTurn, translateUpdate, translateEnd, translateError } = require("./translate")

const parse = (lines) => lines.map((l) => JSON.parse(l))
const chunk = (text) => ({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } })

test("first agent_message_chunk opens the stream (message_start + block_start + delta); later chunks are bare deltas", () => {
  const s = createState()
  const first = parse(translateUpdate(s, chunk("hel")))
  assert.equal(first.length, 3)
  assert.equal(first[0].type, "stream_event")
  assert.equal(first[0].event.type, "message_start")
  assert.ok(first[0].event.message.id) // the reducer keys the placeholder on this id
  assert.deepEqual(first[1].event, { type: "content_block_start", index: 0, content_block: { type: "text" } })
  assert.deepEqual(first[2].event, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hel" } })
  const second = parse(translateUpdate(s, chunk("lo")))
  assert.equal(second.length, 1)
  assert.deepEqual(second[0].event.delta, { type: "text_delta", text: "lo" })
})

test("agent_thought_chunk maps to a thinking_delta", () => {
  const s = createState()
  const lines = parse(translateUpdate(s, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } }))
  assert.deepEqual(lines, [{ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } } }])
})

test("tool_call closes the open text block (consolidated assistant, SAME id) then emits the tool_use", () => {
  const s = createState()
  const openId = parse(translateUpdate(s, chunk("hel")))[0].event.message.id
  parse(translateUpdate(s, chunk("lo")))
  const lines = parse(translateUpdate(s, { sessionUpdate: "tool_call", toolCallId: "tc1", title: "Read file", kind: "read", rawInput: { path: "a.txt" } }))
  assert.equal(lines.length, 2)
  assert.deepEqual(lines[0], { type: "assistant", message: { id: openId, role: "assistant", content: [{ type: "text", text: "hello" }] } })
  assert.deepEqual(lines[1].message.content, [{ type: "tool_use", id: "tc1", name: "Read file", input: { path: "a.txt" } }])
})

test("tool_call_update completed/failed emits the user tool_result; other statuses emit nothing", () => {
  const s = createState()
  translateUpdate(s, { sessionUpdate: "tool_call", toolCallId: "tc1", title: "run" })
  assert.deepEqual(translateUpdate(s, { sessionUpdate: "tool_call_update", toolCallId: "tc1", status: "in_progress" }), [])
  const done = parse(translateUpdate(s, { sessionUpdate: "tool_call_update", toolCallId: "tc1", status: "completed", content: [{ type: "content", content: { type: "text", text: "ok!" } }] }))
  assert.deepEqual(done, [{ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tc1", content: "ok!", is_error: false }] } }])
  translateUpdate(s, { sessionUpdate: "tool_call", toolCallId: "tc2", title: "run" })
  const failed = parse(translateUpdate(s, { sessionUpdate: "tool_call_update", toolCallId: "tc2", status: "failed", rawOutput: "exit 1" }))
  assert.deepEqual(failed[0].message.content[0], { type: "tool_result", tool_use_id: "tc2", content: "exit 1", is_error: true })
})

test("a completed update for a NEVER-SEEN tool id synthesizes the tool_use before its result", () => {
  const s = createState()
  const lines = parse(translateUpdate(s, { sessionUpdate: "tool_call_update", toolCallId: "ghost", status: "completed", title: "mystery" }))
  assert.equal(lines.length, 2)
  assert.deepEqual(lines[0].message.content[0].id, "ghost")
  assert.equal(lines[1].message.content[0].tool_use_id, "ghost")
})

test("plan renders as ONE synthetic plan tool call with a stable id, replaced (not stacked) on refresh", () => {
  const s = createState()
  const first = parse(translateUpdate(s, { sessionUpdate: "plan", entries: [{ content: "step 1", status: "pending" }] }))
  assert.equal(first.length, 2)
  assert.deepEqual(first[0].message.content[0].name, "plan")
  assert.match(first[1].message.content[0].content, /\[pending\] step 1/)
  const second = parse(translateUpdate(s, { sessionUpdate: "plan", entries: [{ content: "step 1", status: "completed" }] }))
  assert.equal(second[0].message.id, first[0].message.id) // same message id ⇒ reducer upsert
  assert.equal(second[1].message.content[0].tool_use_id, first[1].message.content[0].tool_use_id)
})

test("unknown update kinds translate to nothing", () => {
  const s = createState()
  assert.deepEqual(translateUpdate(s, { sessionUpdate: "available_commands_update", commands: [] }), [])
  assert.deepEqual(translateUpdate(s, null), [])
})

test("end_turn consolidates the open text then emits result success; cancelled emits result cancelled", () => {
  const s = createState()
  const openId = parse(translateUpdate(s, chunk("bye")))[0].event.message.id
  const lines = parse(translateEnd(s, "end_turn"))
  assert.deepEqual(lines[0].message, { id: openId, role: "assistant", content: [{ type: "text", text: "bye" }] })
  assert.deepEqual(lines[1], { type: "result", subtype: "success" })
  assert.deepEqual(parse(translateEnd(s, "cancelled")), [{ type: "result", subtype: "cancelled" }])
})

test("errors close the turn with an is_error result; auth_required adds the login-URL assistant text", () => {
  const s = createState()
  const plain = parse(translateError(s, { message: "agent process exited (code 1)" }))
  assert.deepEqual(plain, [{ type: "result", is_error: true, error: "agent process exited (code 1)" }])
  const auth = parse(translateError(s, { message: "auth required", subtype: "auth_required", loginUrl: "https://login.example/x" }))
  assert.equal(auth.length, 2)
  assert.match(auth[0].message.content[0].text, /https:\/\/login\.example\/x/)
  assert.deepEqual(auth[1], { type: "result", is_error: true, error: "auth required", subtype: "auth_required" })
})

test("a crash carries the CLI's stderr tail into the result, so the cause outlives the container", () => {
  // opencode died with `agent process exited (code 1)` on every turn and the reason was
  // unrecoverable: the tail only went to container logs, which vanish with the container.
  const s = createState()
  const crash = parse(translateError(s, { message: "agent process exited (code 1)", stderr: "EACCES: /home/oyren/.cache" }))
  assert.deepEqual(crash, [
    { type: "result", is_error: true, error: "agent process exited (code 1)", stderr: "EACCES: /home/oyren/.cache" },
  ])
})

test("beginTurn drops the open text block and per-turn plan ids, but keeps seen tool ids", () => {
  const s = createState()
  translateUpdate(s, chunk("dangling"))
  translateUpdate(s, { sessionUpdate: "plan", entries: [] })
  const planId = s.planMsgId
  beginTurn(s)
  assert.deepEqual(translateEnd(s, "end_turn").length, 1) // nothing to consolidate — just the result line
  beginTurn(s)
  translateUpdate(s, { sessionUpdate: "plan", entries: [] })
  assert.notEqual(s.planMsgId, planId) // a fresh turn gets a fresh plan card
})
