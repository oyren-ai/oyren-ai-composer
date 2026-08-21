// Shared plumbing for the session-token-gated KasmVNC stream proxies.
//
// TWO streams ride this now — /_oyren/zed (the streamed editor) and /_oyren/browser (the in-VM
// browser) — and they differ only in prefix and loopback port, so the contract below is written
// once and instantiated twice rather than copied.
//
// URL CONTRACT:
//   <session-origin><prefix>/<SESSION_TOKEN>/<rest>?<query>
// proxies HTTP requests AND WebSocket upgrades to 127.0.0.1:<port> with the `<prefix>/<token>`
// prefix STRIPPED. KasmVNC has no --server-base-path equivalent, so unlike /_oyren/ide the prefix
// must never reach it; its web client uses relative ASSET URLs, which is what makes the
// stripped-prefix form workable (same contract as /_oyren/port, minus the port segment).
//  - The client's WEBSOCKET is NOT relative: it builds `wss://<host>/<path-setting>` at the origin
//    root (default path "websockify"), which lands outside the prefix and dies on the app fallback.
//    The page URL must carry `?path=<prefix-without-slash>/<token>/websockify` (the client reads
//    query params over defaults); a bare page load without a query 302s to that form so a directly-
//    opened stream URL works without the embedding frontend knowing the client's query API.
//  - Token at path segment 3, validated exactly like /_oyren/ide/<token> (constant-time compare,
//    fails closed 401 when SESSION_TOKEN is unset or mismatched). The KasmVNC listener itself runs
//    with no auth on loopback — this token is its ONLY gate, mirroring the editor's 3131.
//  - GET …/<token> with no rest and no trailing slash → 302 to …/<token>/ (query preserved).
//  - Nothing listening on the port (stream disabled for this session, or still booting) → 503.
const { proxyHttp } = require("./proxyHttp")
const { proxyWs } = require("./proxyWs")
const { tokenEq } = require("./sessionAuth")

// The token is a path segment, so it can arrive percent-encoded. A malformed escape can't match
// anything anyway, so it falls through to the raw string and fails the constant-time compare.
const decode = (s) => { try { return decodeURIComponent(s) } catch { return s } }

/**
 * Build one stream proxy. `prefix` is the two-segment mount ("/_oyren/zed"), `port` the loopback
 * KasmVNC websocket listener, `starting` the 503 body shown while the stack is still coming up.
 */
function createVncProxy({ prefix, port: defaultPort, starting }) {
  /**
   * Parse `<prefix>/<token>/<rest>?<query>`. Returns null when rawUrl is not under the prefix.
   * Otherwise: token ("" when missing — auth rejects it), downstream ("/<rest>" + query, the
   * proxied path once the 2-segment prefix is stripped), needsSlash (bare `…/<token>` form →
   * caller 302s so the client's relative asset URLs resolve under the prefix).
   */
  function parsePath(rawUrl) {
    const raw = String(rawUrl || "/")
    const qi = raw.indexOf("?")
    const path = qi === -1 ? raw : raw.slice(0, qi)
    const query = qi === -1 ? "" : raw.slice(qi)
    if (path !== prefix && !path.startsWith(prefix + "/")) return null
    const segs = path.split("/") // ["", "_oyren", "<name>", "<token>", ...rest]
    const rawToken = segs[3] || "" // as received (still percent-encoded) — for building redirects
    const token = decode(rawToken)
    const needsSlash = segs.length === 4 // exactly "…/<name>/<token>" — no rest, no trailing slash
    const downstream = "/" + segs.slice(4).join("/") + query
    return { token, rawToken, downstream, needsSlash }
  }

  /** HTTP side. `vncPort` is injectable for tests; the router passes nothing and gets the default. */
  function handle(req, res, { sessionToken, vncPort = defaultPort }) {
    const p = parsePath(req.url)
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
    // Bare page load (no query at all) → 302 injecting the client's websocket path (header comment).
    // The value is encodeURIComponent'd once because the client decodes it exactly once.
    if (p.downstream === "/" && req.method === "GET") {
      const wsPath = `${prefix.slice(1)}/${p.rawToken}/websockify`
      res.writeHead(302, { location: `${prefix}/${p.rawToken}/?path=${encodeURIComponent(wsPath)}` })
      return res.end()
    }
    req.url = p.downstream // proxyHttp forwards req.url as the upstream path
    return proxyHttp(req, res, vncPort, () => {
      // charset declared: both `starting` strings carry non-ASCII (an em dash, an ellipsis) and
      // without it the browser guesses latin-1 and shows mojibake.
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" })
      res.end(starting)
    })
  }

  /** WS side — the load-bearing one (KasmVNC is WebSocket-first). proxyWs replays req.url verbatim,
   *  so the prefix is stripped by mutating it first. No `res` on an upgrade socket → raw status line. */
  function handleUpgrade(req, socket, head, { sessionToken, vncPort = defaultPort }) {
    const p = parsePath(req.url)
    if (!p || !tokenEq(p.token, sessionToken)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
      return socket.destroy()
    }
    req.url = p.downstream
    return proxyWs(req, socket, head, vncPort)
  }

  return { PREFIX: prefix, PORT: defaultPort, parsePath, handle, handleUpgrade }
}

module.exports = { createVncProxy }
