// The dispatch seam: router.js consults the Host header BEFORE any path routing, so on the dsh host
// every path is dsh (gated), while the session host never enters that branch. config.js and
// dshHost.js read the env at require time, so it is set before the first require.
process.env.SESSION_TOKEN = "11111111-2222-4333-8444-555555555555"
process.env.OYREN_PUBLIC_ORIGIN = "https://abc123.sandboxes.oyren.ai"
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { createRouter } = require("./router")
const { DSH_HOST, makeReq, makeRes } = require("./dshFakes")

const SESSION_HOST = "abc123.sandboxes.oyren.ai"
const handle = createRouter({ supervisor: { exposedPort: 0 }, workdir: "/tmp", controlToken: "c", routes: null })
const tick = () => new Promise((r) => setImmediate(r))

test("on the dsh host, plain / is dsh's 401 — not the gateway page the session host serves there", async () => {
  const res = makeRes()
  handle(makeReq({ url: "/", host: DSH_HOST }), res)
  await tick()
  assert.equal(res.statusCode, 401)
  assert.equal(res.headers["content-type"], "text/plain; charset=utf-8")
  assert.equal(res.body, "unauthorized")
})

test("the session host never enters the dsh branch: / still renders the gateway page", async () => {
  const res = makeRes()
  handle(makeReq({ url: "/", host: SESSION_HOST }), res)
  await tick()
  assert.equal(res.statusCode, 200)
  assert.match(res.headers["content-type"], /text\/html/)
})

test("/_oyren/health answers the same on both hosts", async () => {
  for (const host of [DSH_HOST, SESSION_HOST]) {
    const res = makeRes()
    handle(makeReq({ url: "/_oyren/health", host }), res)
    await tick()
    assert.equal(res.statusCode, 200, host)
    assert.equal(JSON.parse(res.body).service, "oyren-sandbox")
  }
})
