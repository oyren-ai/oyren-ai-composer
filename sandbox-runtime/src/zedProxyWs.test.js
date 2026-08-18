const { test } = require("node:test")
const assert = require("node:assert")
const http = require("http")
const net = require("net")
const { ZED_PREFIX, handleZedProxyUpgrade } = require("./zedProxy")

const T = "11111111-2222-4333-8444-555555555555"
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", r))

async function withFront(opts, fn) {
  const front = http.createServer()
  front.on("upgrade", (req, socket, head) => handleZedProxyUpgrade(req, socket, head, opts))
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

test("upgrades reach the zed port with the prefix stripped from req.url", async () => {
  // KasmVNC is WebSocket-first, so this replay contract is the proxy's load-bearing side. The
  // upstream echoes the request line it received — proving proxyWs replayed the REWRITTEN url.
  const upstream = net.createServer((sock) => {
    sock.once("data", (d) => sock.write("UP:" + d.toString().split("\r\n")[0]))
  })
  await listen(upstream)
  const zedPort = upstream.address().port
  await withFront({ sessionToken: T, zedPort }, async (port) => {
    const got = await upgradeReq(port, `${ZED_PREFIX}/${T}/websockify?scale=auto`)
    assert.equal(got, "UP:GET /websockify?scale=auto HTTP/1.1")
  })
  upstream.close()
})

test("a wrong token answers a raw 401 and drops the socket", async () => {
  await withFront({ sessionToken: T }, async (port) => {
    assert.match(await upgradeReq(port, `${ZED_PREFIX}/nope/websockify`), /^HTTP\/1\.1 401 /)
  })
})

test("fails closed over WS when the sandbox has no session token at all", async () => {
  await withFront({ sessionToken: "" }, async (port) => {
    assert.match(await upgradeReq(port, `${ZED_PREFIX}/${T}/websockify`), /^HTTP\/1\.1 401 /)
  })
})
