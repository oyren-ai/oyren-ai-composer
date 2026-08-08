const { test } = require("node:test")
const assert = require("node:assert")
const net = require("net")
const { proxyWs, rebuildHead } = require("./proxyWs")

test("rebuildHead re-serializes the request line and raw headers", () => {
  const req = { method: "GET", url: "/ws?token=x", rawHeaders: ["Host", "localhost", "Upgrade", "websocket"] }
  assert.equal(rebuildHead(req), "GET /ws?token=x HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n\r\n")
})

const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", r))

test("pipes an upgrade through to the upstream and streams bytes back", async () => {
  // Upstream replays the first line of whatever head it receives, prefixed — proving the
  // rebuilt request reached it and the response was piped back to the client socket.
  const upstream = net.createServer((sock) => {
    sock.once("data", (d) => sock.write("UP:" + d.toString().split("\r\n")[0]))
  })
  await listen(upstream)

  const req = { method: "GET", url: "/ws", rawHeaders: ["Host", "localhost", "Upgrade", "websocket"] }
  const front = net.createServer((sock) => proxyWs(req, sock, Buffer.alloc(0), upstream.address().port))
  await listen(front)

  const got = await new Promise((resolve) => {
    const client = net.connect(front.address().port, "127.0.0.1")
    client.once("data", (d) => { resolve(d.toString()); client.destroy() })
  })
  assert.equal(got, "UP:GET /ws HTTP/1.1")
  upstream.close()
  front.close()
})