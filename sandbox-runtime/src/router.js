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
//  - /_oyren/port/*   → session-token-gated proxy to any loopback port (token in the path; portProxy.js).
//  - /_oyren/browser/*→ the in-VM browser's KasmVNC stream (browserProxy.js) — the surface that makes
//    an agent CLI's loopback OAuth callback reachable, because that browser IS on this machine.
//  - /how-to-deploy   → static page (legacy, kept for compatibility).
//  - everything else  → routerApp.js: Routes config → supervisor.exposedPort → gateway page.
const { routeFor } = require("./routeFor")
const { serveStatic } = require("./staticSite")
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
const { handleAppRoute } = require("./routerApp")
const { handlePortProxy } = require("./portProxy")
const { handleZedProxy } = require("./zedProxy")
const { handleBrowserProxy } = require("./browserProxy")
const { handleZedClipboard } = require("./zedClipboard")
const { STATIC_DIR, SESSION_TOKEN, WORKSPACE_DIR, PORT } = require("./config")
const { queryTokenOk } = require("./sessionAuth")
const { IDE_PORT, ideAuth, ideFolderRedirect } = require("./ide")

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
    if (route.kind === "ide") {
      if (!ideAuth(req.url, SESSION_TOKEN)) {
        res.writeHead(401, { "content-type": "text/plain" })
        return res.end("unauthorized")
      }
      // webClientServer prefers an x-forwarded-prefix header over --server-base-path when building
      // the workbench's asset and WS URLs. proxyHttp forwards client headers verbatim, so a
      // caller-supplied one would rewrite those URLs out from under us. Drop it.
      delete req.headers["x-forwarded-prefix"]
      const redirect = ideFolderRedirect(req.url, workdir, WORKSPACE_DIR)
      if (redirect) {
        res.writeHead(302, { location: redirect })
        return res.end()
      }
      // NO url rewrite: openvscode is started with --server-base-path covering this whole prefix,
      // so it expects to receive the full path. Stripping it would break every generated asset URL.
      return proxyHttp(req, res, IDE_PORT, () => {
        res.writeHead(503, { "content-type": "text/plain" })
        res.end("editor starting…")
      })
    }
    // Session-token-gated proxy to any loopback port — how the editor's Oyren Preview (and any
    // session-origin URL the agent hands out) reaches an unrouted dev server. See portProxy.js.
    if (route.kind === "port") return handlePortProxy(req, res, { sessionToken: SESSION_TOKEN, selfPort: PORT })
    // The streamed-Zed stream (Next's ZedStreamView iframe) — token-gated like the port proxy,
    // prefix-stripped onto the KasmVNC listener. See zedProxy.js.
    if (route.kind === "zed") return handleZedProxy(req, res, { sessionToken: SESSION_TOKEN })
    if (route.kind === "browser") return handleBrowserProxy(req, res, { sessionToken: SESSION_TOKEN })
    // Image → clipboard for the streamed-Zed session: the Oyren UI POSTs a pasted image here and we
    // put it on Zed's X clipboard (+ optional auto Ctrl+V). Token-gated like the zed stream itself.
    if (route.kind === "zed-clipboard") return handleZedClipboard(req, res, { sessionToken: SESSION_TOKEN })
    if (route.kind === "static") return serveStatic(res, STATIC_DIR, (req.url || "/").split("?")[0])

    // Everything else is the user's app: configured routes → exposedPort → gateway page.
    return handleAppRoute(req, res, { routes, supervisor })
  }
}

module.exports = { createRouter }
