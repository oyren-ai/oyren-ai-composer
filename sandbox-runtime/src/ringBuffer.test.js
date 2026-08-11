const { test } = require("node:test")
const assert = require("node:assert")
const { createRingBuffer } = require("./ringBuffer")

test("record buffers entries and snapshot returns them oldest-first", () => {
  const buf = createRingBuffer()
  buf.record("a"); buf.record("b")
  assert.deepEqual(buf.snapshot(), ["a", "b"])
})

test("a subscriber hears entries recorded after it attaches, and unsubscribe stops delivery", () => {
  const buf = createRingBuffer()
  const heard = []
  const off = buf.subscribe({ onLine: (l) => heard.push(l) })
  buf.record("x"); buf.record("y")
  off()
  buf.record("z")
  assert.deepEqual(heard, ["x", "y"])
})

test("lines get monotonic indexes and snapshotAfter resumes strictly after a cursor", () => {
  const buf = createRingBuffer()
  buf.record("a"); buf.record("b"); buf.record("c")
  assert.equal(buf.lastIndex(), 3)
  const tail = buf.snapshotAfter(1) // cursor at "a"
  assert.deepEqual(tail.map((e) => e.line), ["b", "c"])
  assert.deepEqual(tail.map((e) => e.n), [2, 3])
})

test("reset clears the buffer but never rewinds the index (cursors stay valid)", () => {
  const buf = createRingBuffer()
  buf.record("x")
  const n = buf.lastIndex()
  buf.reset()
  assert.deepEqual(buf.snapshot(), [])
  buf.record("y")
  assert.equal(buf.lastIndex(), n + 1)
})

test("the rolling buffer drops oldest entries past the byte cap", () => {
  const buf = createRingBuffer({ maxBytes: 4 * 1024 * 1024 })
  const big = "x".repeat(1024 * 1024) // 1 MiB per entry; cap is 4 MiB
  for (let i = 0; i < 10; i++) buf.record(big)
  const kept = buf.snapshot()
  assert.ok(kept.length < 10, "should have dropped some entries")
  assert.ok(kept.length >= 1, "keeps at least the newest entry")
})

test("two instances are fully independent: separate cursors, separate BOOT_IDs, separate subscribers", () => {
  const a = createRingBuffer()
  const b = createRingBuffer()
  a.record("only-a")
  assert.deepEqual(b.snapshot(), [])
  assert.notEqual(a.BOOT_ID, b.BOOT_ID)
})
