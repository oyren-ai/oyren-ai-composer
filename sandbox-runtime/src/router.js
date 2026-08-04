// HTTP dispatch: combine the pure routeFor() decision with live supervisor state and the
// configurable Routes registry.
//  - /_oyren/health   → always 200, NEVER proxied (DO's health check must pass during long builds).
//  - /_oyren/control  → control API (CONTROL_TOKEN).
//  - /agent/message   → one headless Claude Code chat turn, ndjson stream-json (SESSION_TOKEN).
//  - /_oyren/download → hand a staged deliverable to the browser over the tunnel (SESSION_TOKEN).
//  - /_oyren/logs     → recent server + app stdout/stderr, HTML viewer + /raw text (SESSION_TOKEN).
//  - /_oyren/runs     → JSON list of detached script runs + their output for the panel (SESSION_TOKEN).
//  - /_oyren/runs.html→ browsable HTML view of those same runs, for a browser tab / iframe (SESSION_TOKEN).
//  - /_oyren/gateway  → landing page with all configured routes + download/logs links.
//  - /how-to-deploy   → static page (legacy, kept for compatibility).
//  - everything else  → check Routes config for a matching prefix; if none, fall back to
//                        supervisor.exposedPort; if that's also unset, show the gateway page.
const { routeFor } = require("./routeFor")
const { serveStatic, serveIndex } = require("./staticSite")
const { proxyHttp } = require("./proxyHttp")
const { handleControl } = require("./control")
const { handleAgentMessage, handleAgentCurrent } = require("./agentChat")
const { handleAgentStream } = require("./agentStream")
const { handleAgentInterrupt, handleAgentModels, handleAgentModel } = require("./agentControl")
const { handleDownload } = require("./download")
const { handleLogs } = require("./logs")
const { handleRuns } = require("./runs")
const { handleRunsPage } = require("./runsPage")
const { handleGateway } = require("./gateway")
const { STATIC_DIR, SESSION_TOKEN } = require("./config")
const { queryTokenOk } = require("./sessionAuth")

function createRouter({ supervisor, workdir, controlToken, routes }) {
  return function handle(req, res) {
    const route = routeFor(req.url)
    if (route.kind === "health") {
      res.writeHead(200, { "content-type": "application/json" })
      // buildId is baked into each image at build time (ARG/ENV BUILD_ID) so a running container reveals
      // exactly which image it booted — the reliable way to tell a fresh launch from a stale cached one.
      return res.end(JSON.stringify({ status: "healthy", service: "oyren-sandbox", buildId: process.env.BUILD_ID || "unknown" }))
    }
    if (route.kind === "control") return handleControl(req, res, { supervisor, workdir, token: controlToken, routes })
    if (route.kind === "agent") return handleAgentMessage(req, res)
    if (route.kind === "agent-stream") return handleAgentStream(req, res)
    if (route.kind === "agent-interrupt") return handleAgentInterrupt(req, res)
    if (route.kind === "agent-models") return handleAgentModels(req, res)
    if (route.kind === "agent-model") return handleAgentModel(req, res)
    if (route.kind === "agent-current") return handleAgentCurrent(req, res)
    if (route.kind === "download") return handleDownload(req, res, { workdir })
    if (route.kind === "logs") return handleLogs(req, res)
    if (route.kind === "runs") return handleRuns(req, res)
    if (route.kind === "runs-page") return handleRunsPage(req, res)
    // The gateway page renders the session token into its download/logs links, and that token is
    // what gates the terminal WS (a root shell), the agent stream and downloads. Serving it
    // unauthenticated handed the whole session to anyone who could guess the hostname — and
    // hostnames are `term-<base36 seconds>-<4 chars of Math.random()>`, not CSPRNG. Gate it.
    // GatewayButton already appends ?token=, so no client change is needed.
    if (route.kind === "gateway") {
      if (!queryTokenOk(req.url, SESSION_TOKEN)) {
        res.writeHead(401, { "content-type": "text/plain" })
        return res.end("unauthorized")
      }
      return handleGateway(req, res, { routes, sessionToken: SESSION_TOKEN, exposedPort: supervisor.exposedPort })
    }
    if (route.kind === "static") return serveStatic(res, STATIC_DIR, (req.url || "/").split("?")[0])

    // --- app routing: try configured routes first, then supervisor.exposedPort fallback ---
    if (routes) {
      const match = routes.match(req.url)
      if (match) {
        // Rewrite the request URL to the downstream path (prefix stripped) before proxying
        const origUrl = req.url
        req.url = match.downstream
        return proxyHttp(req, res, match.route.port, () => {
          // Restore original URL so the gateway fallback renders correctly
          req.url = origUrl
          showGateway(req, res, { routes, supervisor, status: 503 })
        })
      }
    }

    const port = supervisor.exposedPort
    if (port) return proxyHttp(req, res, port, () => showGateway(req, res, { routes, supervisor, status: 503 }))

    // Nothing exposed, nothing routed — show the gateway landing page
    return showGateway(req, res, { routes, supervisor, status: 200 })
  }
}

/** Serve the gateway page as the fallback (when no app is up or as a 503 when the app crashed).
 *
 *  Unlike the explicit /_oyren/gateway route this must NOT 401: it is what the user's own app URL
 *  falls back to, so an unauthenticated visitor should still get a readable "nothing running yet"
 *  page rather than a bare error. It must equally not leak the session token — plain `/` reaches
 *  here — so the token is passed only when the request actually proves it already has it, and
 *  otherwise the page simply renders without its download/logs links (which would be useless to an
 *  unauthenticated viewer anyway). */
function showGateway(req, res, { routes, supervisor, status }) {
  return handleGateway(req, res, {
    routes,
    sessionToken: queryTokenOk(req.url, SESSION_TOKEN) ? SESSION_TOKEN : "",
    exposedPort: supervisor.exposedPort,
  })
}

module.exports = { createRouter }
