// Session-token-gated port proxy.
//
// URL CONTRACT:
//   <session-origin>/_oyren/port/<SESSION_TOKEN>/<port>/<rest>?<query>
// proxies HTTP requests AND WebSocket upgrades to 127.0.0.1:<port> with the
// `/_oyren/port/<token>/<port>` prefix STRIPPED — downstream path = "/<rest>", query preserved,
// headers forwarded verbatim.
//  - Token at path segment 3, validated exactly like /_oyren/ide/<token> (constant-time compare,
//    fails closed 401 when SESSION_TOKEN is unset or mismatched). WHY: an unauthenticated proxy
//    would open every loopback service — including 127.0.0.1:3131, the editor — so a tokenless
//    hit here would bypass ideAuth and hand out a root-equivalent editor session.
//  - <port>: all-digits 1..65535, else 400. The runtime's own PORT is 400 too — a self-proxy
//    would loop this server back into itself.
//  - GET …/<port> with no rest and no trailing slash → 302 to …/<port>/ (query preserved).
//  - Nothing listening on the port → 502 naming 127.0.0.1:<port>.
//
// CAVEAT: this is a pure prefix proxy — nothing rewrites response bodies. An app that emits
// absolute asset paths ("/static/app.js") escapes the prefix and 404s; it needs a configured
// base path, or a real route (`oyren route add`), which serves it at "/" instead.
const { proxyHttp } = require("./proxyHttp")
const { proxyWs } = require("./proxyWs")
const { parsePortPath, portAuth } = require("./portPath")

function deny(res, status, body) {
  res.writeHead(status, { "content-type": "text/plain" })
  res.end(body)
}

/** HTTP side. `selfPort` is the runtime's own cfg.PORT (the self-proxy loop guard). */
function handlePortProxy(req, res, { sessionToken, selfPort }) {
  const p = parsePortPath(req.url)
  if (!p || !portAuth(p.token, sessionToken)) return deny(res, 401, "unauthorized")
  if (!p.port) return deny(res, 400, "invalid port")
  if (p.port === selfPort) return deny(res, 400, "refusing to proxy to the runtime's own port")
  if (p.needsSlash && req.method === "GET") {
    const qi = req.url.indexOf("?")
    const [path, query] = qi === -1 ? [req.url, ""] : [req.url.slice(0, qi), req.url.slice(qi)]
    res.writeHead(302, { location: path + "/" + query })
    return res.end()
  }
  req.url = p.downstream // proxyHttp forwards req.url as the upstream path
  return proxyHttp(req, res, p.port, () => deny(res, 502, `nothing listening on 127.0.0.1:${p.port}`))
}

/** WS side. proxyWs replays req.url verbatim, so the prefix is stripped by mutating it first.
 *  Upgrade failures answer with a raw status line — there is no `res` on an upgrade socket. */
function handlePortProxyUpgrade(req, socket, head, { sessionToken, selfPort }) {
  const fail = (line) => { socket.write(`HTTP/1.1 ${line}\r\n\r\n`); socket.destroy() }
  const p = parsePortPath(req.url)
  if (!p || !portAuth(p.token, sessionToken)) return fail("401 Unauthorized")
  if (!p.port || p.port === selfPort) return fail("400 Bad Request")
  req.url = p.downstream
  return proxyWs(req, socket, head, p.port)
}

module.exports = { handlePortProxy, handlePortProxyUpgrade }
