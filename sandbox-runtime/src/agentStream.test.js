process.env.SESSION_TOKEN = "tok" // config reads this at require-time
const { test } = require("node:test")
const assert = require("node:assert")
const broadcast = require("./agentBroadcast")
const { handleAgentStream } = require("./agentStream")
const { drive } = require("./agentFakes")

test("GET without the token is 401", async () => {
  const res = await drive(handleAgentStream, { method: "GET", url: "/agent/stream" })
  assert.equal(res.status, 401)
})

test("the stream replays the recent buffer then tails live lines", async () => {
  broadcast.reset()
  broadcast.record(JSON.stringify({ type: "assistant", n: 1 }))
  const res = await drive(handleAgentStream, { method: "GET", url: "/agent/stream?token=tok" })
  assert.equal(res.status, 200)
  assert.deepEqual(res.lines(), ['{"type":"assistant","n":1}']) // replayed snapshot
  broadcast.record(JSON.stringify({ type: "result", n: 2 })) // live line after attach
  assert.deepEqual(res.lines(), ['{"type":"assistant","n":1}', '{"type":"result","n":2}'])
})

test("indexed mode sends a hello frame, replays after the cursor, and frames live lines", async () => {
  broadcast.reset()
  broadcast.record('{"type":"assistant","a":1}')
  broadcast.record('{"type":"assistant","a":2}')
  const cursor = broadcast.lastIndex() - 1 // pump already saw the first line
  const res = await drive(handleAgentStream, { method: "GET", url: `/agent/stream?token=tok&mode=indexed&after=${cursor}` })
  const frames = res.lines().map((l) => JSON.parse(l))
  assert.equal(frames[0].type, "hello")
  assert.equal(frames[0].boot, broadcast.BOOT_ID)
  assert.equal(frames[0].last, broadcast.lastIndex())
  assert.deepEqual(frames.slice(1), [{ n: cursor + 1, line: '{"type":"assistant","a":2}' }])
  broadcast.record('{"type":"result"}') // live line after attach → framed too
  const live = res.lines().map((l) => JSON.parse(l)).at(-1)
  assert.deepEqual(live, { n: broadcast.lastIndex(), line: '{"type":"result"}' })
})

test("legacy mode (no mode param) stays raw lines even now that indexes exist", async () => {
  broadcast.reset()
  broadcast.record('{"type":"assistant"}')
  const res = await drive(handleAgentStream, { method: "GET", url: "/agent/stream?token=tok" })
  assert.deepEqual(res.lines(), ['{"type":"assistant"}'])
})

test("a dropped reader unsubscribes and stops receiving lines", async () => {
  broadcast.reset()
  const res = await drive(handleAgentStream, { method: "GET", url: "/agent/stream?token=tok" })
  res.writableEnded = false
  res.emit("close") // browser navigated away
  broadcast.record(JSON.stringify({ type: "result" }))
  assert.equal(res.lines().length, 0)
})

test("a write failure reaps the reader so a half-open socket stops getting fanned lines", async () => {
  broadcast.reset()
  const res = await drive(handleAgentStream, { method: "GET", url: "/agent/stream?token=tok" })
  // The socket is half-open (wall-severed) — no `close` event, but the next write throws.
  res.write = () => { throw new Error("EPIPE") }
  broadcast.record(JSON.stringify({ type: "assistant" })) // fan-out → write throws → reader reaped
  // Writes work again, but the reader must already be unsubscribed (no leaked subscriber).
  const seen = []
  res.write = (c) => seen.push(c.toString())
  broadcast.record(JSON.stringify({ type: "result" }))
  assert.equal(seen.length, 0)
})
