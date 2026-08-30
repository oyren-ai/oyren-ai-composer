const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const { tmuxUnitState, __reset, TTL_MS } = require("./tmuxUnit")

beforeEach(() => __reset())

const execAnswering = (err, stdout, calls = []) => (cmd, args, cb) => {
  calls.push([cmd, ...args])
  cb(err, stdout)
}

test("reports what systemctl says once the probe lands, and 'unknown' before it", () => {
  const calls = []
  assert.equal(tmuxUnitState({ exec: execAnswering(null, "active\n", calls) }), "unknown")
  assert.equal(tmuxUnitState({ exec: execAnswering(null, "active\n") }), "active")
  assert.deepEqual(calls, [["systemctl", "is-active", "oyren-tmux"]])
})

test("a failing unit still names its state: systemctl exits non-zero but prints it", () => {
  tmuxUnitState({ exec: execAnswering(Object.assign(new Error("x"), { code: 3 }), "failed\n") })
  assert.equal(tmuxUnitState({ exec: execAnswering(null, "active\n") }), "failed")
})

test("no systemctl on this host means 'absent', never a crash", () => {
  tmuxUnitState({ exec: execAnswering(Object.assign(new Error("x"), { code: "ENOENT" }), "") })
  assert.equal(tmuxUnitState({ exec: () => { throw new Error("must not re-probe inside TTL") }, now: () => TTL_MS - 1 }), "absent")
})

test("probes at most once per TTL, then refreshes", () => {
  let t = 0
  const calls = []
  const opts = { exec: execAnswering(null, "active\n", calls), now: () => t }
  tmuxUnitState(opts); tmuxUnitState(opts)
  assert.equal(calls.length, 1)
  t = TTL_MS + 1
  tmuxUnitState(opts)
  assert.equal(calls.length, 2)
})
