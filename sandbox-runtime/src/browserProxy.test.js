// The browser stream shares vncProxy.js with the Zed stream, so this does NOT re-test the parsing
// contract (zedProxy.test.js owns it). What it pins is what is genuinely browser-specific and would
// break silently: its own prefix and port, the ?path= injection carrying THAT prefix (a copy-paste
// of zed's would point the client's WebSocket at the wrong stream), the token gate, and the 503
// body — which for an on-demand unit has to say "not running", not "starting…".
const { test } = require("node:test")
const assert = require("node:assert/strict")
const http = require("http")
const { BROWSER_PREFIX, BROWSER_PORT, parseBrowserPath, handleBrowserProxy } = require("./browserProxy")

const T = "11111111-2222-4333-8444-555555555555"
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", r))

function request(port, path) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path }, (res) => {
      let data = ""
      res.on("data", (d) => (data += d))
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }))
    })
    req.end()
  })
}

async function withFront(opts, fn) {
  const front = http.createServer((req, res) => handleBrowserProxy(req, res, opts))
  await listen(front)
  try { return await fn(front.address().port) } finally { front.close() }
}

test("mounts on its own prefix and port, not the zed stream's", () => {
  assert.equal(BROWSER_PREFIX, "/_oyren/browser")
  assert.equal(BROWSER_PORT, 6091)
  assert.equal(parseBrowserPath("/_oyren/zed/" + T + "/"), null) // the other stream is not ours
  const p = parseBrowserPath(`${BROWSER_PREFIX}/${T}/websockify?scale=auto`)
  assert.equal(p.token, T)
  assert.equal(p.downstream, "/websockify?scale=auto")
})

test("bare page load 302s with the websocket path under THIS prefix", async () => {
  await withFront({ sessionToken: T }, async (port) => {
    const res = await request(port, `${BROWSER_PREFIX}/${T}/`)
    assert.equal(res.status, 302)
    const loc = decodeURIComponent(res.headers.location)
    assert.match(loc, new RegExp(`\\?path=_oyren/browser/${T}/websockify$`))
  })
})

test("a wrong or missing token is refused, never proxied", async () => {
  await withFront({ sessionToken: T }, async (port) => {
    assert.equal((await request(port, `${BROWSER_PREFIX}/nope/`)).status, 401)
    assert.equal((await request(port, `${BROWSER_PREFIX}/`)).status, 401)
  })
  // Fails closed when the session has no token at all — the KasmVNC listener has no auth of its own.
  await withFront({ sessionToken: "" }, async (port) => {
    assert.equal((await request(port, `${BROWSER_PREFIX}/${T}/`)).status, 401)
  })
})

test("nothing listening ⇒ 503 that says the browser is not running (it is on-demand)", async () => {
  await withFront({ sessionToken: T, browserPort: 1 }, async (port) => {
    const res = await request(port, `${BROWSER_PREFIX}/${T}/index.html`)
    assert.equal(res.status, 503)
    assert.match(res.body, /not running/)
    assert.match(res.body, /oyren-open/)
  })
})
