// WebSocket upgrade dispatch, split from server.js: the token-gated /terminal PTY, the editor's
// own WS, the /_oyren/port proxy, then the configured-routes / exposed-port app fallback.
const cfg = require("./config")
const { wsRouteFor } = require("./routeFor")
const { proxyWs } = require("./proxyWs")
const { IDE_PORT, ideAuth } = require("./ide")
const { handlePortProxyUpgrade } = require("./portProxy")
const { handleZedProxyUpgrade } = require("./zedProxy")

// The WS upgrade handler runs outside any request try/catch — a throw here (bad proxy target, parse
// error) would become an uncaughtException and kill every session. Guard it so one bad upgrade only
// drops that socket.
function safeUpgrade(handler) {
  return (req, socket, head) => {
    try { handler(req, socket, head) } catch (e) {
      console.error("[upgrade] failed:", e && e.message)
      try { socket.destroy() } catch {}
    }
  }
}

/** The `server.on("upgrade")` handler: terminal PTY, editor WS, port proxy, then the app. */
function createUpgradeHandler({ termWss, routes, supervisor }) {
  return safeUpgrade((req, socket, head) => {
    const route = wsRouteFor(req.url)
    if (route.kind === "terminal") {
      const url = new URL(req.url, "http://localhost")
      if (!cfg.SESSION_TOKEN || url.searchParams.get("token") !== cfg.SESSION_TOKEN) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
        return socket.destroy()
      }
      return termWss.handleUpgrade(req, socket, head, (ws) => termWss.emit("connection", ws, req))
    }
    if (route.kind === "ide") {
      // The token is in the PATH here, not the query: openvscode's client builds this URL from its
      // --server-base-path and only puts reconnectionToken in the query string.
      if (!ideAuth(req.url, cfg.SESSION_TOKEN)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
        return socket.destroy()
      }
      // proxyWs replays the ORIGINAL url (unlike proxyHttp, which rewrites it to the stripped
      // downstream path) — which is exactly what the editor needs, since its base path must survive.
      return proxyWs(req, socket, head, IDE_PORT)
    }
    // Session-token-gated WS proxy to any loopback port (dev-server HMR sockets ride this) —
    // before the app fallback so a catch-all route can never shadow it. See portProxy.js.
    if (route.kind === "port") {
      return handlePortProxyUpgrade(req, socket, head, { sessionToken: cfg.SESSION_TOKEN, selfPort: cfg.PORT })
    }
    // The streamed-Zed stream — KasmVNC is WebSocket-first, so this is its load-bearing path.
    if (route.kind === "zed") {
      return handleZedProxyUpgrade(req, socket, head, { sessionToken: cfg.SESSION_TOKEN })
    }
    // WebSocket: try routes first, then supervisor.exposedPort
    if (routes) {
      const match = routes.match(req.url)
      if (match) return proxyWs(req, socket, head, match.route.port)
    }
    if (supervisor.exposedPort) return proxyWs(req, socket, head, supervisor.exposedPort)
    socket.destroy()
  })
}

module.exports = { createUpgradeHandler, safeUpgrade }
