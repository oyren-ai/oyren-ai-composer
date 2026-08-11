// Raw TCP passthrough for the user app's OWN WebSocket upgrades. We replay the upgrade request
// line + headers to 127.0.0.1:<port> and then pipe bytes both ways, so the app's WS handshake and
// frames flow untouched. (The token-gated `/terminal` PTY is handled separately in server.js.)
const net = require("net")

/** Re-serialize the incoming upgrade request (request line + raw headers) for the upstream socket. */
function rebuildHead(req) {
  let head = `${req.method} ${req.url} HTTP/1.1\r\n`
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    head += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`
  }
  return head + "\r\n"
}

function proxyWs(req, socket, head, port) {
  const upstream = net.connect(port, "127.0.0.1", () => {
    upstream.write(rebuildHead(req))
    if (head && head.length) upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  upstream.on("error", () => socket.destroy())
  socket.on("error", () => upstream.destroy())
}

module.exports = { proxyWs, rebuildHead }
