const { test } = require("node:test")
const assert = require("node:assert")
const track = require("./agentTurnTrack")

test("an interactive send (no id) tracks nothing and reports null state", () => {
  track.beginTurn(undefined)
  track.recordLine('{"type":"assistant"}', false)
  assert.deepEqual(track.turnState(), { turnId: null, done: null })
  assert.equal(track.replay("anything"), null)
})

test("an id-tagged turn buffers lines, closes on result, and replays by id", () => {
  track.beginTurn("t1")
  track.recordLine('{"type":"assistant","n":1}', false)
  assert.deepEqual(track.turnState(), { turnId: "t1", done: false })
  track.recordLine('{"type":"result"}', true)
  assert.deepEqual(track.turnState(), { turnId: "t1", done: true })
  assert.deepEqual(track.replay("t1"), ['{"type":"assistant","n":1}', '{"type":"result"}'])
  assert.equal(track.replay("other"), null) // a different id can't be replayed
})

test("beginning a new id-tagged turn drops the previous one", () => {
  track.beginTurn("a"); track.recordLine("x", false)
  track.beginTurn("b")
  assert.equal(track.replay("a"), null)
  assert.deepEqual(track.turnState(), { turnId: "b", done: false })
})
