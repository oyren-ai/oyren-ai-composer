const { test } = require("node:test")
const assert = require("node:assert/strict")
const { quiesceCommand } = require("./quiesce")

const seams = (order, execCode = 0) => ({
  stdout: () => {},
  checkpoint: async () => { order.push("checkpoint") },
  control: async (action) => { order.push(`control:${action}`) },
  exec: async (cmd, args) => { order.push(`exec:${cmd} ${args.join(" ")}`); return { code: execCode, stdout: "", stderr: "" } },
})

test("the order is checkpoint, stop, then the root-side quiesce", async () => {
  const order = []
  assert.equal(await quiesceCommand([], seams(order)), 0)
  assert.equal(order[0], "checkpoint")
  assert.equal(order[1], "control:stop")
  assert.match(order[2], /^exec:sudo -n .*oyren-quiesce/)
})

test("a failing checkpoint or stop never blocks the snapshot preparation", async () => {
  const order = []
  const s = seams(order)
  s.checkpoint = async () => { throw new Error("git wedged") }
  s.control = async () => { throw new Error("no runtime") }
  assert.equal(await quiesceCommand([], s), 0)
  assert.match(order[0], /^exec:/)
})

test("the root-side script's exit code is the command's", async () => {
  assert.equal(await quiesceCommand([], seams([], 7)), 7)
})
