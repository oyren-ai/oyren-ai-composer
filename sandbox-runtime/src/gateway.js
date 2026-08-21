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
const { surfacesCard, routesCard, downloadsCard, logsCard } = require("./gatewaySections")
const { howToCard, reservedCard } = require("./gatewayReserved")
const { IDE_PREFIX, IDE_PORT } = require("./ide")
const { ZED_PREFIX, ZED_PORT } = require("./zedProxy")
const { BROWSER_PREFIX, BROWSER_PORT } = require("./browserProxy")

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

/** The workbench surfaces, each linked with the session token in the path segment its auth reads
 *  (ide.js / vncProxy.js check segment 3). Rendered tokenless — routerApp's unauthenticated
 *  fallback — the links degrade to the bare prefix, exactly like the download/logs links do. */
async function probeSurfaces(sessionToken, probe) {
  const gated = (prefix) => (sessionToken ? `${prefix}/${encodeURIComponent(sessionToken)}/` : `${prefix}/`)
  const [ide, zed, browser] = await Promise.all([IDE_PORT, ZED_PORT, BROWSER_PORT].map((p) => probe(p)))
  return [
    { name: "VS Code", path: `${IDE_PREFIX}/`, href: gated(IDE_PREFIX), up: ide },
    { name: "Zed", path: `${ZED_PREFIX}/`, href: gated(ZED_PREFIX), up: zed },
    { name: "Browser", path: `${BROWSER_PREFIX}/`, href: gated(BROWSER_PREFIX), up: browser },
    { name: "Terminal", path: "/terminal", href: null, up: null }, // WebSocket — nothing to open, nothing to probe
  ]
}

/** Build the HTML for the gateway page. `routes` is an array from Routes.list(), `sessionToken`
 *  is the SESSION_TOKEN (carried on every gated link), `exposedPort` is the supervisor's default
 *  port. `probe` is injectable so tests don't depend on what happens to listen on this machine. */
async function renderGateway({ routes = [], sessionToken = "", exposedPort = null, probe = tcpProbe } = {}) {
  const [probes, expUp, surfaces] = await Promise.all([
    Promise.all(routes.map(async (r) => ({ ...r, listening: await probe(r.port) }))),
    exposedPort ? probe(exposedPort) : false,
    probeSurfaces(sessionToken, probe),
  ])
  const query = sessionToken ? `?token=${encodeURIComponent(sessionToken)}` : ""
  const body = `  <main>
    <h1>Oyren Gateway</h1>
    <p class="sub">This Codespace is running. The routes below are what its public URL serves.</p>

    ${surfacesCard(surfaces)}

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
