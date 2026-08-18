// Session-token-gated proxy to the streamed-Zed KasmVNC listener.
//
// URL CONTRACT:
//   <session-origin>/_oyren/zed/<SESSION_TOKEN>/<rest>?<query>
// proxies HTTP requests AND WebSocket upgrades to 127.0.0.1:6090 with the `/_oyren/zed/<token>`
// prefix STRIPPED. KasmVNC has no --server-base-path equivalent, so unlike /_oyren/ide the prefix
// must never reach it; its web client uses relative asset URLs, which is what makes the
// stripped-prefix form workable (same contract as /_oyren/port, minus the port segment).
//  - Token at path segment 3, validated exactly like /_oyren/ide/<token> (constant-time compare,
//    fails closed 401 when SESSION_TOKEN is unset or mismatched). The KasmVNC listener itself runs
//    with no auth on loopback — this token is its ONLY gate, mirroring the editor's 3131.
//  - GET …/zed/<token> with no rest and no trailing slash → 302 to …/<token>/ (query preserved).
//  - Nothing listening on 6090 (non-zed session, or the stack still booting) → 503.
const { proxyHttp } = require("./proxyHttp")
const { proxyWs } = require("./proxyWs")
const { tokenEq } = require("./sessionAuth")

const ZED_PREFIX = "/_oyren/zed"
// The oyren-zed unit's KasmVNC websocket listener (composer deploy/zed/start-zed.mjs).
const ZED_PORT = Number(process.env.OYREN_ZED_PORT || 6090)

// The token is a path segment, so it can arrive percent-encoded. A malformed escape can't match
// anything anyway, so it falls through to the raw string and fails the constant-time compare.
const decode = (s) => { try { return decodeURIComponent(s) } catch { return s } }

/**
 * Parse `/_oyren/zed/<token>/<rest>?<query>`. Returns null when rawUrl is not under ZED_PREFIX.
 * Otherwise: token ("" when missing — auth rejects it), downstream ("/<rest>" + query, the proxied
 * path once the 2-segment prefix is stripped), needsSlash (bare `…/<token>` form → caller 302s so
 * the client's relative asset URLs resolve under the prefix).
 */
function parseZedPath(rawUrl) {
  const raw = String(rawUrl || "/")
  const qi = raw.indexOf("?")
  const path = qi === -1 ? raw : raw.slice(0, qi)
  const query = qi === -1 ? "" : raw.slice(qi)
  if (path !== ZED_PREFIX && !path.startsWith(ZED_PREFIX + "/")) return null
  const segs = path.split("/") // ["", "_oyren", "zed", "<token>", ...rest]
  const token = decode(segs[3] || "")
  const needsSlash = segs.length === 4 // exactly "…/zed/<token>" — no rest, no trailing slash
  const downstream = "/" + segs.slice(4).join("/") + query
  return { token, downstream, needsSlash }
}

/** HTTP side. `zedPort` is injectable for tests; the router passes nothing and gets ZED_PORT. */
function handleZedProxy(req, res, { sessionToken, zedPort = ZED_PORT }) {
  const p = parseZedPath(req.url)
  if (!p || !tokenEq(p.token, sessionToken)) {
    res.writeHead(401, { "content-type": "text/plain" })
    return res.end("unauthorized")
  }
  if (p.needsSlash && req.method === "GET") {
    const qi = req.url.indexOf("?")
    const [path, query] = qi === -1 ? [req.url, ""] : [req.url.slice(0, qi), req.url.slice(qi)]
    res.writeHead(302, { location: path + "/" + query })
    return res.end()
  }
  req.url = p.downstream // proxyHttp forwards req.url as the upstream path
  return proxyHttp(req, res, zedPort, () => {
    res.writeHead(503, { "content-type": "text/plain" })
    res.end("zed stream starting…")
  })
}

/** WS side — the load-bearing one (KasmVNC is WebSocket-first). proxyWs replays req.url verbatim,
 *  so the prefix is stripped by mutating it first. No `res` on an upgrade socket → raw status line. */
function handleZedProxyUpgrade(req, socket, head, { sessionToken, zedPort = ZED_PORT }) {
  const p = parseZedPath(req.url)
  if (!p || !tokenEq(p.token, sessionToken)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
    return socket.destroy()
  }
  req.url = p.downstream
  return proxyWs(req, socket, head, zedPort)
}

module.exports = { ZED_PREFIX, ZED_PORT, parseZedPath, handleZedProxy, handleZedProxyUpgrade }
