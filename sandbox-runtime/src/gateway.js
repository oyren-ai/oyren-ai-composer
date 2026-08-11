// Serves the gateway landing page at `/_oyren/gateway`. This is the first thing a user sees when
// no default app is exposed — a clean HTML page listing every configured route, the download
// endpoint, and instructions for LLMs on how to add routes.
//
// The page uses only inline styles (no external CSS/JS), so it renders even when the container has
// no internet and no build step. All links are relative (no hardcoded port), so they work whether
// the public URL is https://x.ondigitalocean.app or http://localhost:8080.
const net = require("net")

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))

/** Quick TCP probe: resolves true if something is listening on the port. */
function probe(port, timeoutMs = 400) {
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
 *  is the SESSION_TOKEN (for download links), `exposedPort` is the supervisor's default port. */
async function renderGateway({ routes = [], sessionToken = "", exposedPort = null } = {}) {
  // Probe each route's port + the exposed port to show live status
  const probes = await Promise.all(
    routes.map(async (r) => ({ ...r, listening: await probe(r.port) })),
  )
  const expUp = exposedPort ? await probe(exposedPort) : false

  const routeRows = probes.length
    ? probes
        .map((r) => {
          const status = r.listening
            ? '<span style="color:#4ade80">● listening</span>'
            : '<span style="color:#f87171">● not listening</span>'
          const link = r.listening
            ? `<a href="${escapeHtml(r.prefix)}" style="color:#93c5fd">${escapeHtml(r.prefix)}</a>`
            : `<span style="color:#6b7280">${escapeHtml(r.prefix)}</span>`
          return `<tr>
            <td style="padding:8px 12px">${link}</td>
            <td style="padding:8px 12px;font-variant-numeric:tabular-nums">${r.port}</td>
            <td style="padding:8px 12px">${escapeHtml(r.label || "—")}</td>
            <td style="padding:8px 12px">${status}</td>
          </tr>`
        })
        .join("")
    : `<tr><td colspan="4" style="padding:12px;color:#6b7280">No routes configured yet.</td></tr>`

  const defaultRow = exposedPort
    ? `<p style="color:#a1a1aa;font-size:14px">Default app port: <strong>${exposedPort}</strong> ${expUp ? '<span style="color:#4ade80">● listening</span>' : '<span style="color:#f87171">● not listening</span>'}</p>`
    : ""

  const downloadHref = sessionToken
    ? `/_oyren/download?token=${encodeURIComponent(sessionToken)}`
    : "/_oyren/download"

  const logsHref = sessionToken
    ? `/_oyren/logs?token=${encodeURIComponent(sessionToken)}`
    : "/_oyren/logs"

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Oyren Gateway</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; margin: 0; }
    body {
      min-height: 100vh; background: #0a0a12; color: #e4e4eb;
      font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      display: flex; justify-content: center; padding: 40px 16px;
    }
    main { max-width: 720px; width: 100%; }
    h1 { font-size: 28px; letter-spacing: -0.4px; margin-bottom: 6px; }
    .sub { color: #a1a1aa; margin-bottom: 28px; }
    .card {
      background: rgba(18,18,28,0.8); border: 1px solid #1e1e2e; border-radius: 14px;
      padding: 20px; margin-bottom: 18px;
    }
    .card h2 { font-size: 16px; margin-bottom: 10px; color: #c4b5fd; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { text-align: left; padding: 8px 12px; color: #71717a; font-weight: 500; border-bottom: 1px solid #1e1e2e; }
    tr:hover { background: rgba(255,255,255,0.02); }
    a { text-decoration: none; }
    a:hover { text-decoration: underline; }
    .btn {
      display: inline-block; padding: 10px 20px; border-radius: 8px; font-size: 14px;
      font-weight: 500; text-decoration: none; transition: background 0.15s;
    }
    .btn-primary { background: #6366f1; color: #fff; }
    .btn-primary:hover { background: #818cf8; text-decoration: none; }
    .btn-secondary { background: #1e1e2e; color: #c4b5fd; border: 1px solid #2e2e3e; }
    .btn-secondary:hover { background: #2a2a3a; text-decoration: none; }
    pre {
      background: #0c0c14; border-radius: 8px; padding: 14px; font-size: 13px;
      overflow-x: auto; color: #c4d0ff; margin-top: 8px;
    }
    code { color: #c4d0ff; font-size: 13px; }
    .actions { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
    .help { color: #71717a; font-size: 13px; margin-top: 8px; line-height: 1.7; }
  </style>
</head>
<body>
  <main>
    <h1>Oyren Gateway</h1>
    <p class="sub">Your container is running. Use the routes below to access services.</p>

    <div class="card">
      <h2>Configured Routes</h2>
      <table>
        <thead><tr><th>Path</th><th>Port</th><th>Label</th><th>Status</th></tr></thead>
        <tbody>${routeRows}</tbody>
      </table>
      ${defaultRow}
    </div>

    <div class="card">
      <h2>Downloads</h2>
      <p style="color:#a1a1aa;font-size:14px;margin-bottom:12px">
        Files staged in <code>/workspace/.oyren-deliver/</code> are available for download.
      </p>
      <a href="${escapeHtml(downloadHref)}" class="btn btn-primary">Open Downloads</a>
    </div>

    <div class="card">
      <h2>Logs</h2>
      <p style="color:#a1a1aa;font-size:14px;margin-bottom:12px">
        Recent server + app output — useful when a route above says "not listening" or an app won't start.
        In-memory only (resets on restart), so it won't help after a container replacement.
      </p>
      <a href="${escapeHtml(logsHref)}" class="btn btn-secondary">View Logs</a>
    </div>

    <div class="card">
      <h2>How to add routes</h2>
      <p style="color:#a1a1aa;font-size:14px">
        From the terminal or as an LLM agent, manage routes with the <code>oyren</code> CLI:
      </p>
      <pre>oyren route add /studio 3000 "Remotion Studio"   # map /studio/* → port 3000
oyren route add / 3000 "Default App"             # catch-all → port 3000
oyren route list                                  # show all routes
oyren route remove /studio                        # remove a route</pre>
      <p class="help">
        Or edit <code>/workspace/.oyren-routes.json</code> directly — changes are picked up automatically.<br>
        The old <code>oyren expose &lt;port&gt;</code> still works as a single-port fallback.
      </p>
    </div>

    <div class="card">
      <h2>Reserved endpoints</h2>
      <table>
        <thead><tr><th>Path</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td style="padding:6px 12px"><code>/_oyren/gateway</code></td><td style="padding:6px 12px">This page</td></tr>
          <tr><td style="padding:6px 12px"><code>/_oyren/download</code></td><td style="padding:6px 12px">Download staged deliverables</td></tr>
          <tr><td style="padding:6px 12px"><code>/_oyren/logs</code></td><td style="padding:6px 12px">Recent server + app logs</td></tr>
          <tr><td style="padding:6px 12px"><code>/_oyren/health</code></td><td style="padding:6px 12px">Health check (always 200)</td></tr>
          <tr><td style="padding:6px 12px"><code>/_oyren/control/*</code></td><td style="padding:6px 12px">Control API (authenticated)</td></tr>
          <tr><td style="padding:6px 12px"><code>/terminal</code></td><td style="padding:6px 12px">WebSocket terminal</td></tr>
          <tr><td style="padding:6px 12px"><code>/agent/message</code></td><td style="padding:6px 12px">Headless agent chat</td></tr>
        </tbody>
      </table>
    </div>
  </main>
</body>
</html>`
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
