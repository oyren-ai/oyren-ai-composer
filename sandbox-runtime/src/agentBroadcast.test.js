const { test } = require("node:test")
const assert = require("node:assert")
const broadcast = require("./agentBroadcast")

test("record buffers lines and snapshot returns them oldest-first", () => {
  broadcast.reset()
  broadcast.record("a"); broadcast.record("b")
  assert.deepEqual(broadcast.snapshot(), ["a", "b"])
})

test("a subscriber hears lines recorded after it attaches, and unsubscribe stops delivery", () => {
  broadcast.reset()
  const heard = []
  const off = broadcast.subscribe({ onLine: (l) => heard.push(l) })
  broadcast.record("x"); broadcast.record("y")
  off()
  broadcast.record("z")
  assert.deepEqual(heard, ["x", "y"])
})

test("snapshot-before-subscribe has no gap and no dupe with live lines", () => {
  broadcast.reset()
  broadcast.record("old")
  const snap = broadcast.snapshot() // ["old"]
  const heard = []
  broadcast.subscribe({ onLine: (l) => heard.push(l) })
  broadcast.record("new")
  assert.deepEqual([...snap, ...heard], ["old", "new"]) // "old" only via snapshot, "new" only via live
})

test("lines get monotonic indexes and snapshotAfter resumes strictly after a cursor", () => {
  broadcast.reset()
  const before = broadcast.lastIndex()
  broadcast.record("a"); broadcast.record("b"); broadcast.record("c")
  assert.equal(broadcast.lastIndex(), before + 3)
  const tail = broadcast.snapshotAfter(before + 1) // cursor at "a"
  assert.deepEqual(tail.map((e) => e.line), ["b", "c"])
  assert.deepEqual(tail.map((e) => e.n), [before + 2, before + 3])
})

test("reset clears the buffer but never rewinds the index (cursors stay valid)", () => {
  broadcast.reset()
  broadcast.record("x")
  const n = broadcast.lastIndex()
  broadcast.reset()
  assert.deepEqual(broadcast.snapshot(), [])
  broadcast.record("y")
  assert.equal(broadcast.lastIndex(), n + 1)
})

test("live subscribers receive each line's index alongside it", () => {
  broadcast.reset()
  const heard = []
  const off = broadcast.subscribe({ onLine: (l, n) => heard.push([l, n]) })
  const before = broadcast.lastIndex()
  broadcast.record("x")
  off()
  assert.deepEqual(heard, [["x", before + 1]])
})

test("the rolling buffer drops oldest lines past the byte cap", () => {
  broadcast.reset()
  const big = "x".repeat(1024 * 1024) // 1 MiB per line; cap is 16 MiB
  for (let i = 0; i < 40; i++) broadcast.record(big)
  const kept = broadcast.snapshot()
  assert.ok(kept.length < 40, "should have dropped some lines")
  assert.ok(kept.length >= 1, "keeps at least the newest line")
})
