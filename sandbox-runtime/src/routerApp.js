// The app-routing tail of the HTTP router, split from router.js: configured Routes first, then
// the supervisor's single exposed port, then the gateway landing page as the last resort.
const { proxyHttp } = require("./proxyHttp")
const { handleGateway } = require("./gateway")
const { queryTokenOk } = require("./sessionAuth")
const { SESSION_TOKEN } = require("./config")

/** Route a non-reserved request: configured routes → exposedPort fallback → gateway page. */
function handleAppRoute(req, res, { routes, supervisor }) {
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

module.exports = { handleAppRoute }
