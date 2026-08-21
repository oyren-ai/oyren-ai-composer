const { test } = require("node:test")
const assert = require("node:assert/strict")
const { handleDshRequest, DSH_PORT, DSH_NOT_RUNNING } = require("./dshRouter")
const { mintDshCookie, DSH_COOKIE } = require("./dshAccess")
const { DSH_HOST, makeReq, makeRes, httpProxySpy } = require("./dshFakes")

const T = "11111111-2222-4333-8444-555555555555"
const NOW = 1_700_000_000
const now = () => NOW
const cookie = `${DSH_COOKIE}=${mintDshCookie(T, NOW - 100).value}`
const PLAIN = "text/plain; charset=utf-8"

function run(reqOpts, opts = {}) {
  const { calls, proxy } = httpProxySpy()
  const req = makeReq(reqOpts)
  const res = makeRes()
  handleDshRequest(req, res, { sessionToken: T, now, proxy, ...opts })
  return { req, res, calls }
}

test("/_oyren/health stays open on the dsh host and is never proxied — the edge probes it", () => {
  const { res, calls } = run({ url: "/_oyren/health" })
  assert.equal(res.statusCode, 200)
  assert.equal(JSON.parse(res.body).service, "oyren-sandbox")
  assert.equal(calls.length, 0)
})

test("a valid ?token= sets the access cookie, strips the token, and proxies to dsh", () => {
  const { res, calls } = run({ url: `/?token=${T}` })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].port, DSH_PORT)
  assert.equal(calls[0].req.url, "/")
  // The cookie rides the upstream response, alongside whatever headers dsh itself sends.
  calls[0].res.writeHead(200, { "content-type": "text/html", "set-cookie": "dsh_own=1" })
  assert.deepEqual(res.headers["set-cookie"], ["dsh_own=1", mintDshCookie(T, NOW).header])
  assert.equal(res.headers["content-type"], "text/html")
})

test("stripping the token keeps the rest of the query and the path", () => {
  const { calls } = run({ url: `/index.html?a=1&token=${T}&b=2` })
  assert.equal(calls[0].req.url, "/index.html?a=1&b=2")
})

test("a valid cookie proxies without minting another one", () => {
  const { res, calls } = run({ url: "/assets/app.js", headers: { cookie: `theme=dark; ${cookie}` } })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].req.url, "/assets/app.js")
  calls[0].res.writeHead(200, { "content-type": "text/javascript" })
  assert.equal(res.headers["set-cookie"], undefined)
})

test("neither token nor cookie ⇒ 401 unauthorized, text/plain with a charset", () => {
  for (const reqOpts of [
    { url: "/" },
    { url: "/?token=nope" },
    { url: "/api/events.mux", headers: { cookie: `${DSH_COOKIE}=${mintDshCookie(T, NOW - 90000).value}` } },
    { url: "/", headers: { cookie: `${DSH_COOKIE}=${mintDshCookie("other", NOW).value}` } },
  ]) {
    const { res, calls } = run(reqOpts)
    assert.equal(res.statusCode, 401, JSON.stringify(reqOpts))
    assert.equal(res.headers["content-type"], PLAIN)
    assert.equal(res.body, "unauthorized")
    assert.equal(calls.length, 0)
  }
})

test("fails closed when the sandbox has no session token at all", () => {
  const { res, calls } = run({ url: `/?token=${T}` }, { sessionToken: "" })
  assert.equal(res.statusCode, 401)
  assert.equal(calls.length, 0)
})

test("dsh refusing the connection is a 503 that says where to start it", () => {
  const { res, calls } = run({ url: "/", headers: { cookie } })
  calls[0].onError()
  assert.equal(res.statusCode, 503)
  assert.equal(res.headers["content-type"], PLAIN)
  assert.equal(res.body, DSH_NOT_RUNNING)
  assert.equal(DSH_NOT_RUNNING, "DeepSeek is not running — open it from the Codespace's dock")
})

test("Host and Origin reach the proxy untouched — dsh's trust fence checks both", () => {
  const { calls } = run({ url: "/api/chat", host: DSH_HOST, headers: { cookie } })
  assert.equal(calls[0].req.headers.host, DSH_HOST)
  assert.equal(calls[0].req.headers.origin, `https://${DSH_HOST}`)
})
