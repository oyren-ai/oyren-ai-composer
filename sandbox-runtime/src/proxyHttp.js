// Dependency-free HTTP reverse proxy to the user's app on 127.0.0.1:<port>. Streams request and
// response bodies (so SSE / chunked / large payloads pass through). On a connection error (app not
// up yet) it calls `onError` — the router serves the how-to-deploy page instead of a blank 502.
const http = require("http")

function proxyHttp(req, res, port, onError) {
  const options = {
    hostname: "127.0.0.1",
    port,
    method: req.method,
    path: req.url,
    headers: req.headers,
  }
  const upstream = http.request(options, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers)
    upRes.pipe(res)
  })
  upstream.on("error", () => {
    if (onError) return onError()
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" })
    res.end("bad gateway")
  })
  req.pipe(upstream)
}

module.exports = { proxyHttp }
