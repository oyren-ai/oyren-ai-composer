const { test } = require("node:test")
const assert = require("node:assert")
const http = require("http")
const { proxyHttp } = require("./proxyHttp")

const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", r))

function request(port, method, path, body) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, method, path }, (res) => {
      let data = ""
      res.on("data", (d) => (data += d))
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }))
    })
    req.end(body)
  })
}

test("forwards method/path/body upstream and streams the response back", async () => {
  const upstream = http.createServer((req, res) => {
    let body = ""
    req.on("data", (d) => (body += d))
    req.on("end", () => {
      res.writeHead(201, { "x-up": "yes", "content-type": "text/plain" })
      res.end(`${req.method} ${req.url} body=${body}`)
    })
  })
  await listen(upstream)
  const front = http.createServer((req, res) => proxyHttp(req, res, upstream.address().port))
  await listen(front)

  const r = await request(front.address().port, "POST", "/echo", "hello")
  assert.equal(r.status, 201)
  assert.equal(r.headers["x-up"], "yes")
  assert.equal(r.body, "POST /echo body=hello")
  upstream.close()
  front.close()
})

test("defaults to 502 when the upstream is unreachable", async () => {
  const front = http.createServer((req, res) => proxyHttp(req, res, 1))
  await listen(front)
  const r = await request(front.address().port, "GET", "/")
  assert.equal(r.status, 502)
  front.close()
})

test("invokes the onError fallback when the upstream is unreachable", async () => {
  const front = http.createServer((req, res) =>
    proxyHttp(req, res, 1, () => { res.writeHead(503, { "content-type": "text/plain" }); res.end("page") }),
  )
  await listen(front)
  const r = await request(front.address().port, "GET", "/")
  assert.equal(r.status, 503)
  assert.equal(r.body, "page")
  front.close()
})