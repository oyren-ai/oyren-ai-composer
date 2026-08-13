const { test } = require("node:test")
const assert = require("node:assert")
const http = require("http")
const net = require("net")
const { handlePortProxyUpgrade } = require("./portProxy")

const T = "11111111-2222-4333-8444-555555555555"
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", r))

async function withFront(opts, fn) {
  const front = http.createServer()
  front.on("upgrade", (req, socket, head) => handlePortProxyUpgrade(req, socket, head, opts))
  await listen(front)
  try { return await fn(front.address().port) } finally { front.close() }
}

/** Raw upgrade client: send an Upgrade request, resolve with the first response bytes. */
function upgradeReq(port, path) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1", () => {
      sock.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`)
    })
    sock.once("data", (d) => { resolve(d.toString()); sock.destroy() })
  })
}

test("upgrades reach the port with the prefix stripped from req.url", async () => {
  // The upstream replays the request line it received — proving proxyWs replayed the REWRITTEN
  // url (prefix stripped, query intact), not the original /_oyren/port/... one.
  const upstream = net.createServer((sock) => {
    sock.once("data", (d) => sock.write("UP:" + d.toString().split("\r\n")[0]))
  })
  await listen(upstream)
  const up = upstream.address().port
  await withFront({ sessionToken: T, selfPort: 8080 }, async (port) => {
    const got = await upgradeReq(port, `/_oyren/port/${T}/${up}/ws/live?x=1`)
    assert.equal(got, "UP:GET /ws/live?x=1 HTTP/1.1")
  })
  upstream.close()
})

test("a wrong token answers a raw 401 and drops the socket", async () => {
  await withFront({ sessionToken: T, selfPort: 8080 }, async (port) => {
    assert.match(await upgradeReq(port, `/_oyren/port/nope/3000/ws`), /^HTTP\/1\.1 401 /)
  })
})

test("the runtime's own port answers a raw 400 — no self-proxy loops over WS either", async () => {
  await withFront({ sessionToken: T, selfPort: 8080 }, async (port) => {
    assert.match(await upgradeReq(port, `/_oyren/port/${T}/8080/ws`), /^HTTP\/1\.1 400 /)
  })
})
