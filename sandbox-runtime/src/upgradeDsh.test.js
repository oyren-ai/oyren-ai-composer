// The upgrade-side dispatch seam, mirror of routerDsh.test.js: the dsh host is checked before any
// path routing, and the session host never enters that branch. Env set before the first require.
process.env.SESSION_TOKEN = "11111111-2222-4333-8444-555555555555"
process.env.OYREN_PUBLIC_ORIGIN = "https://abc123.sandboxes.oyren.ai"
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { createUpgradeHandler } = require("./upgrade")
const { DSH_HOST, makeReq, makeSocket } = require("./dshFakes")

const SESSION_HOST = "abc123.sandboxes.oyren.ai"
const termWss = { handleUpgrade() { throw new Error("terminal must not be reached") } }
const onUpgrade = createUpgradeHandler({ termWss, routes: null, supervisor: { exposedPort: 0 } })

test("on the dsh host an ungated upgrade is dsh's raw 401, whatever the path", () => {
  for (const url of ["/api/events.mux", "/terminal?token=nope", "/"]) {
    const socket = makeSocket()
    onUpgrade(makeReq({ url, host: DSH_HOST }), socket, Buffer.alloc(0))
    assert.equal(socket.written, "HTTP/1.1 401 Unauthorized\r\n\r\n", url)
    assert.equal(socket.destroyed, true)
  }
})

test("the session host never enters the dsh branch: with nothing exposed the socket just drops", () => {
  const socket = makeSocket()
  onUpgrade(makeReq({ url: "/api/events.mux", host: SESSION_HOST }), socket, Buffer.alloc(0))
  assert.equal(socket.written, "")
  assert.equal(socket.destroyed, true)
})
