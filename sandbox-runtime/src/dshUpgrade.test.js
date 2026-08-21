const { test } = require("node:test")
const assert = require("node:assert/strict")
const { handleDshUpgrade, DSH_PORT } = require("./dshRouter")
const { mintDshCookie, DSH_COOKIE } = require("./dshAccess")
const { DSH_HOST, makeReq, makeSocket, wsProxySpy } = require("./dshFakes")

const T = "11111111-2222-4333-8444-555555555555"
const NOW = 1_700_000_000
const now = () => NOW
const cookie = `${DSH_COOKIE}=${mintDshCookie(T, NOW - 100).value}`
const HEAD = Buffer.from("frame")

function run(reqOpts, opts = {}) {
  const { calls, proxy } = wsProxySpy()
  const req = makeReq({ headers: { connection: "Upgrade", upgrade: "websocket" }, ...reqOpts })
  const socket = makeSocket()
  handleDshUpgrade(req, socket, HEAD, { sessionToken: T, now, proxy, ...opts })
  return { req, socket, calls }
}

test("dsh's WebSockets ride the cookie straight through to :3080, head bytes included", () => {
  const { socket, calls } = run({ url: "/api/events.mux", headers: { cookie } })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].port, DSH_PORT)
  assert.equal(DSH_PORT, 3080)
  assert.equal(calls[0].req.url, "/api/events.mux")
  assert.equal(calls[0].head, HEAD)
  assert.equal(socket.destroyed, false)
  assert.equal(socket.written, "")
})

test("a valid ?token= also admits an upgrade, with the token stripped from the replayed url", () => {
  const { calls } = run({ url: `/api/events.host?token=${T}` })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].req.url, "/api/events.host")
})

test("no token, no cookie ⇒ a raw 401 and the socket is dropped, never proxied", () => {
  for (const reqOpts of [
    { url: "/api/events.mux" },
    { url: "/api/events.mux?token=nope" },
    { url: "/api/events.mux", headers: { cookie: `${DSH_COOKIE}=${mintDshCookie(T, NOW - 90000).value}` } },
  ]) {
    const { socket, calls } = run(reqOpts)
    assert.equal(socket.written, "HTTP/1.1 401 Unauthorized\r\n\r\n", JSON.stringify(reqOpts))
    assert.equal(socket.destroyed, true)
    assert.equal(calls.length, 0)
  }
})

test("fails closed over WS when the sandbox has no session token at all", () => {
  const { socket, calls } = run({ url: "/api/events.mux", headers: { cookie } }, { sessionToken: "" })
  assert.equal(socket.destroyed, true)
  assert.equal(calls.length, 0)
})

test("Host reaches the WS proxy unchanged — proxyWs replays it verbatim and dsh checks it", () => {
  const { calls } = run({ url: "/api/events.mux", host: DSH_HOST, headers: { cookie } })
  assert.equal(calls[0].req.headers.host, DSH_HOST)
  assert.ok(calls[0].req.rawHeaders.includes(DSH_HOST))
})
