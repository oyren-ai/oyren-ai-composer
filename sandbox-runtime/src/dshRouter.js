// Everything on the dsh host (dshHost.js) is the DeepSeek Harness UI on 127.0.0.1:3080 — HTTP and
// WebSocket alike (dsh's /api/events.mux and /api/events.host are WS, no SSE fallback). The gate:
//
//   GET /_oyren/health         → open, same body as the session host (the edge probes it)
//   valid ?token= (tokenEq)    → Set-Cookie oyren_dsh_access + proxy, token stripped from the URL
//   valid cookie               → proxy
//   otherwise                  → 401 (WS: raw 401 + destroy)
//   dsh refuses the connection → 503 "DeepSeek is not running — …"
//
// Host and Origin are forwarded verbatim: dsh's browser-trust fence only admits requests whose Host
// equals its --trusted-host (dsh-web.sh passes this hostname) and whose Origin equals that Host.
const { proxyHttp } = require("./proxyHttp")
const { proxyWs } = require("./proxyWs")
const { queryTokenOk } = require("./sessionAuth")
const { mintDshCookie, verifyDshCookie } = require("./dshAccess")
const { writeHealth } = require("./health")

// dsh's own default; dsh-web.sh reads the same variable.
const DSH_PORT = Number(process.env.OYREN_DSH_PORT || 3080)
const DSH_NOT_RUNNING = "DeepSeek is not running — open it from the Codespace's dock"
const PLAIN = { "content-type": "text/plain; charset=utf-8" }
const unixNow = () => Math.floor(Date.now() / 1000)

/** "token" | "cookie" | null — what, if anything, admits this request. */
function dshAccess(req, sessionToken, nowSec) {
  if (queryTokenOk(req.url, sessionToken)) return "token"
  if (verifyDshCookie(req.headers.cookie, sessionToken, nowSec)) return "cookie"
  return null
}

/** The url without its `token` query param: the session token must not reach dsh's logs or referers. */
function stripToken(rawUrl) {
  const u = new URL(rawUrl || "/", "http://localhost")
  u.searchParams.delete("token")
  return u.pathname + u.search
}

/** Add the Set-Cookie to whatever response the proxy (or the 503 path) writes, keeping dsh's own. */
function addSetCookie(res, header) {
  const writeHead = res.writeHead.bind(res)
  res.writeHead = (status, headers = {}) =>
    writeHead(status, { ...headers, "set-cookie": [].concat(headers["set-cookie"] || [], header) })
}

function handleDshRequest(req, res, { sessionToken, now = unixNow, proxy = proxyHttp }) {
  if ((req.url || "/").split("?")[0] === "/_oyren/health") return writeHealth(res)
  const access = dshAccess(req, sessionToken, now())
  if (!access) {
    res.writeHead(401, PLAIN)
    return res.end("unauthorized")
  }
  if (access === "token") {
    req.url = stripToken(req.url)
    addSetCookie(res, mintDshCookie(sessionToken, now()).header)
  }
  return proxy(req, res, DSH_PORT, () => {
    if (!res.headersSent) res.writeHead(503, PLAIN)
    res.end(DSH_NOT_RUNNING)
  })
}

/** The same gate for upgrades: dsh's WebSockets carry the cookie, never a token. */
function handleDshUpgrade(req, socket, head, { sessionToken, now = unixNow, proxy = proxyWs }) {
  const access = dshAccess(req, sessionToken, now())
  if (!access) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
    return socket.destroy()
  }
  if (access === "token") req.url = stripToken(req.url)
  return proxy(req, socket, head, DSH_PORT)
}

module.exports = { DSH_PORT, DSH_NOT_RUNNING, handleDshRequest, handleDshUpgrade }
