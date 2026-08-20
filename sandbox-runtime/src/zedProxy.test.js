const { test } = require("node:test")
const assert = require("node:assert/strict")
const http = require("http")
const { ZED_PREFIX, parseZedPath, handleZedProxy } = require("./zedProxy")

const T = "11111111-2222-4333-8444-555555555555"
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", r))

function request(port, path) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path, headers: { "x-probe": "yes" } }, (res) => {
      let data = ""
      res.on("data", (d) => (data += d))
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }))
    })
    req.end()
  })
}

async function withFront(opts, fn) {
  const front = http.createServer((req, res) => handleZedProxy(req, res, opts))
  await listen(front)
  try { return await fn(front.address().port) } finally { front.close() }
}

test("parses token and the prefix-stripped downstream path, query verbatim", () => {
  const p = parseZedPath(`${ZED_PREFIX}/${T}/websockify?scale=auto&x=%2F`)
  assert.equal(p.token, T)
  assert.equal(p.downstream, "/websockify?scale=auto&x=%2F")
  assert.equal(p.needsSlash, false)
})

test("the bare …/<token> form needs a slash redirect; trailing slash does not", () => {
  assert.equal(parseZedPath(`${ZED_PREFIX}/${T}`).needsSlash, true)
  assert.equal(parseZedPath(`${ZED_PREFIX}/${T}/`).needsSlash, false)
  assert.equal(parseZedPath(`${ZED_PREFIX}/${T}/`).downstream, "/")
})

test("a percent-encoded token decodes; a malformed escape falls through raw", () => {
  const p = parseZedPath(`${ZED_PREFIX}/${encodeURIComponent("a b")}/x`)
  assert.equal(p.token, "a b")
  assert.equal(p.rawToken, "a%20b") // undecoded, for rebuilding redirect URLs verbatim
  assert.equal(parseZedPath(`${ZED_PREFIX}/%zz/x`).token, "%zz")
})

test("paths outside the prefix parse as null", () => {
  assert.equal(parseZedPath("/_oyren/zedx/t/"), null)
  assert.equal(parseZedPath("/other"), null)
})

test("proxies to the zed port with the prefix stripped, headers intact", async () => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" })
    res.end(`${req.method} ${req.url} probe=${req.headers["x-probe"]}`)
  })
  await listen(upstream)
  const zedPort = upstream.address().port
  await withFront({ sessionToken: T, zedPort }, async (port) => {
    const r = await request(port, `${ZED_PREFIX}/${T}/vnc.html?autoconnect=1`)
    assert.equal(r.status, 200)
    assert.equal(r.body, "GET /vnc.html?autoconnect=1 probe=yes")
  })
  upstream.close()
})

test("a wrong or missing token is a 401 — the KasmVNC listener has no auth of its own", async () => {
  await withFront({ sessionToken: T }, async (port) => {
    assert.equal((await request(port, `${ZED_PREFIX}/nope/`)).status, 401)
    assert.equal((await request(port, `${ZED_PREFIX}//vnc.html`)).status, 401)
    assert.equal((await request(port, ZED_PREFIX)).status, 401)
  })
})

test("fails closed when the sandbox has no session token at all", async () => {
  await withFront({ sessionToken: "" }, async (port) => {
    assert.equal((await request(port, `${ZED_PREFIX}/${T}/`)).status, 401)
  })
})

test("bare …/<token> 302s to the trailing-slash form, preserving the query", async () => {
  await withFront({ sessionToken: T }, async (port) => {
    const r = await request(port, `${ZED_PREFIX}/${T}?a=1`)
    assert.equal(r.status, 302)
    assert.equal(r.headers.location, `${ZED_PREFIX}/${T}/?a=1`)
  })
})

test("a bare page load 302s to inject the client's ?path= websocket setting", async () => {
  await withFront({ sessionToken: T }, async (port) => {
    const r = await request(port, `${ZED_PREFIX}/${T}/`)
    assert.equal(r.status, 302)
    const wsPath = encodeURIComponent(`_oyren/zed/${T}/websockify`)
    assert.equal(r.headers.location, `${ZED_PREFIX}/${T}/?path=${wsPath}`)
  })
})

test("a page load that already carries a query proxies through untouched", async () => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" })
    res.end(`GET ${req.url}`)
  })
  await listen(upstream)
  await withFront({ sessionToken: T, zedPort: upstream.address().port }, async (port) => {
    const r = await request(port, `${ZED_PREFIX}/${T}/?path=x`)
    assert.equal(r.status, 200)
    assert.equal(r.body, "GET /?path=x")
  })
  upstream.close()
})

test("nothing listening on the zed port answers 503 (stack booting / non-zed session)", async () => {
  const dead = http.createServer(() => {})
  await listen(dead)
  const zedPort = dead.address().port
  await new Promise((r) => dead.close(r)) // freed — now guaranteed nothing listens there
  await withFront({ sessionToken: T, zedPort }, async (port) => {
    // The ?path= form (what a bare load redirects to) — a bare "/" would 302 before proxying.
    const r = await request(port, `${ZED_PREFIX}/${T}/?path=x`)
    assert.equal(r.status, 503)
    assert.match(r.body, /zed stream/)
  })
})
