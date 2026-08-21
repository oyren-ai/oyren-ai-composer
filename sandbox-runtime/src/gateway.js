// Serves the gateway page at `/_oyren/gateway` — what the Oyren app's header "Codespace gateway"
// popover embeds, and what a Codespace's public URL falls back to when nothing is routed
// (routerApp.js). It shows the workbench surfaces this Codespace serves, every configured route
// with a live port probe, the downloads + logs pages, how an agent adds routes, and which paths
// are reserved.
//
// Inline CSS only (pageShell.js), so it renders with no internet and no build step. All links are
// relative (no hardcoded port), so they work whether the public URL is
// https://x.ondigitalocean.app or http://localhost:8080.
const net = require("net")
const { renderPage, escapeHtml } = require("./pageShell")
const { routesCard, downloadsCard, logsCard } = require("./gatewaySections")
const { howToCard, reservedCard } = require("./gatewayReserved")

/** Quick TCP probe: resolves true if something is listening on the port. */
function tcpProbe(port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1")
    const done = (ok) => { sock.destroy(); resolve(ok) }
    sock.setTimeout(timeoutMs)
    sock.once("connect", () => done(true))
    sock.once("timeout", () => done(false))
    sock.once("error", () => done(false))
  })
}

/** Build the HTML for the gateway page. `routes` is an array from Routes.list(), `sessionToken`
 *  is the SESSION_TOKEN (carried on every gated link), `exposedPort` is the supervisor's default
 *  port. `probe` is injectable so tests don't depend on what happens to listen on this machine. */
async function renderGateway({ routes = [], sessionToken = "", exposedPort = null, probe = tcpProbe } = {}) {
  const [probes, expUp] = await Promise.all([
    Promise.all(routes.map(async (r) => ({ ...r, listening: await probe(r.port) }))),
    exposedPort ? probe(exposedPort) : false,
  ])
  const query = sessionToken ? `?token=${encodeURIComponent(sessionToken)}` : ""
  const body = `  <main>
    <h1>Oyren Gateway</h1>
    <p class="sub">Your container is running. Use the routes below to access services.</p>

    ${routesCard(probes, exposedPort, expUp)}

    ${downloadsCard("/_oyren/download" + query)}

    ${logsCard("/_oyren/logs" + query)}

    ${howToCard()}

    ${reservedCard()}
  </main>`
  return renderPage({ title: "Oyren Gateway", body })
}

/** HTTP handler for GET /_oyren/gateway. */
async function handleGateway(req, res, { routes, sessionToken, exposedPort }) {
  try {
    const html = await renderGateway({
      routes: routes ? routes.list() : [],
      sessionToken,
      exposedPort,
    })
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(html)
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" })
    res.end("gateway render error: " + (err && err.message))
  }
}

module.exports = { handleGateway, renderGateway, escapeHtml }
