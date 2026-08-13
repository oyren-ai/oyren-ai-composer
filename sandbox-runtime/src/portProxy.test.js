const { test } = require("node:test")
const assert = require("node:assert")
const http = require("http")
const { handlePortProxy } = require("./portProxy")

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
  const front = http.createServer((req, res) => handlePortProxy(req, res, opts))
  await listen(front)
  try { return await fn(front.address().port) } finally { front.close() }
}

test("proxies with the prefix stripped, query and headers intact", async () => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" })
    res.end(`${req.method} ${req.url} probe=${req.headers["x-probe"]}`)
  })
  await listen(upstream)
  const up = upstream.address().port
  await withFront({ sessionToken: T, selfPort: 8080 }, async (port) => {
    const r = await request(port, `/_oyren/port/${T}/${up}/echo/deep?a=1&b=2`)
    assert.equal(r.status, 200)
    assert.equal(r.body, "GET /echo/deep?a=1&b=2 probe=yes")
  })
  upstream.close()
})

test("a wrong or missing token is a 401 — the proxy must not open loopback to the world", async () => {
  await withFront({ sessionToken: T, selfPort: 8080 }, async (port) => {
    assert.equal((await request(port, `/_oyren/port/nope/3000/`)).status, 401)
    assert.equal((await request(port, `/_oyren/port//3000/`)).status, 401)
    assert.equal((await request(port, `/_oyren/port`)).status, 401)
  })
})

test("fails closed when the sandbox has no session token at all", async () => {
  await withFront({ sessionToken: "", selfPort: 8080 }, async (port) => {
    assert.equal((await request(port, `/_oyren/port/${T}/3000/`)).status, 401)
  })
})

test("bare …/<port> 302s to the trailing-slash form, preserving the query", async () => {
  await withFront({ sessionToken: T, selfPort: 8080 }, async (port) => {
    const r = await request(port, `/_oyren/port/${T}/3000?a=1`)
    assert.equal(r.status, 302)
    assert.equal(r.headers.location, `/_oyren/port/${T}/3000/?a=1`)
  })
})

test("a dead port is a 502 naming the loopback target", async () => {
  await withFront({ sessionToken: T, selfPort: 8080 }, async (port) => {
    const r = await request(port, `/_oyren/port/${T}/1/`)
    assert.equal(r.status, 502)
    assert.match(r.body, /127\.0\.0\.1:1/)
  })
})

test("invalid ports and the runtime's own port are a 400", async () => {
  await withFront({ sessionToken: T, selfPort: 8080 }, async (port) => {
    assert.equal((await request(port, `/_oyren/port/${T}/abc/`)).status, 400)
    assert.equal((await request(port, `/_oyren/port/${T}/8080/`)).status, 400) // self-proxy loop guard
  })
})
