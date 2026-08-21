// Fake req/res/socket + proxy spies for the dsh host-routing suites. No real sockets: the proxy is
// injected, so what these tests pin is the GATE (health / token / cookie / 401 / 503) and exactly
// what reaches the proxy — url, port, untouched Host — not Node's networking.
const { Readable } = require("stream")

const DSH_HOST = "dsh-abc123.sandboxes.oyren.ai"

function makeReq({ url = "/", host = DSH_HOST, headers = {}, method = "GET" } = {}) {
  const req = Readable.from([""])
  req.method = method
  req.url = url
  req.headers = { host, origin: `https://${host}`, ...headers }
  req.rawHeaders = Object.entries(req.headers).flat()
  return req
}

function makeRes() {
  return {
    statusCode: 0, headers: null, body: "", headersSent: false,
    writeHead(s, h) { this.statusCode = s; this.headers = h || {}; this.headersSent = true; return this },
    end(b) { this.body = b || "" },
  }
}

function makeSocket() {
  return {
    written: "", destroyed: false,
    write(s) { this.written += s },
    destroy() { this.destroyed = true },
  }
}

/** A proxyHttp stand-in: records the call; the test decides whether the upstream answers or refuses. */
function httpProxySpy() {
  const calls = []
  const proxy = (req, res, port, onError) => calls.push({ req, res, port, onError })
  return { calls, proxy }
}

/** A proxyWs stand-in, same idea. */
function wsProxySpy() {
  const calls = []
  const proxy = (req, socket, head, port) => calls.push({ req, socket, head, port })
  return { calls, proxy }
}

module.exports = { DSH_HOST, makeReq, makeRes, makeSocket, httpProxySpy, wsProxySpy }
