process.env.SESSION_TOKEN = "tok" // config reads this at require-time
const { test } = require("node:test")
const assert = require("node:assert")
const { startKeepalive } = require("./agentKeepalive")
const { fakeRes } = require("./agentFakes")

const pings = (res) => res.chunks.filter((c) => c.includes('"type":"ping"')).length

test("startKeepalive commits headers + writes pings each tick, and stops on stop()", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] })
  let headed = 0
  const res = fakeRes()
  const stop = startKeepalive(res, () => { headed++ }, 15_000)
  t.mock.timers.tick(15_000)
  t.mock.timers.tick(15_000)
  assert.equal(pings(res), 2)
  assert.ok(headed >= 1)
  stop()
  t.mock.timers.tick(15_000)
  assert.equal(pings(res), 2) // no further pings after stop
})

test("startKeepalive never writes once the response has ended", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] })
  const res = fakeRes(); res.writableEnded = true
  startKeepalive(res, () => {}, 15_000)
  t.mock.timers.tick(15_000)
  assert.equal(res.chunks.length, 0)
})
