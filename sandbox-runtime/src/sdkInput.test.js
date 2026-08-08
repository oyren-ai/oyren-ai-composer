const { test } = require("node:test")
const assert = require("node:assert")
const { createInputStream, buildUserMessage } = require("./sdkInput")

const tick = () => new Promise((r) => setImmediate(r))

test("the generator blocks until a message is pushed, then yields it", async () => {
  const { stream, push } = createInputStream()
  let got = null
  const reader = (async () => { for await (const m of stream) { got = m; break } })()
  await tick()
  assert.equal(got, null) // nothing yet — it is blocked
  push({ type: "user", n: 1 })
  await reader
  assert.deepEqual(got, { type: "user", n: 1 })
})

test("a message pushed mid-turn (while the reader is between yields) is delivered next", async () => {
  const { stream, push } = createInputStream()
  const seen = []
  const reader = (async () => { for await (const m of stream) { seen.push(m.n); if (m.n === 2) break } })()
  push({ n: 1 })
  await tick()
  push({ n: 2 }) // arrives after the reader consumed #1 and is awaiting again
  await reader
  assert.deepEqual(seen, [1, 2])
})

test("close() ends the generator", async () => {
  const { stream, close } = createInputStream()
  const reader = (async () => { let count = 0; for await (const _ of stream) count++; return count })()
  close()
  assert.equal(await reader, 0)
})

test("buildUserMessage wraps a string prompt and passes a content array through verbatim", () => {
  assert.deepEqual(buildUserMessage("hi"), { type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] }, parent_tool_use_id: null })
  const blocks = [{ type: "image", source: {} }, { type: "text", text: "look" }]
  assert.deepEqual(buildUserMessage(blocks).message.content, blocks)
})
