// The live cards of the gateway page (gateway.js assembles them): the configured routes, downloads and logs. Pure string renderers over already-probed input — nothing
// here touches the network, which is what keeps them trivially testable.
const { escapeHtml } = require("./pageShell")

const dot = (up, yes = "listening", no = "not listening") =>
  up ? `<span class="ok">● ${yes}</span>` : `<span class="bad">● ${no}</span>`

/** The Routes registry, each with its port probe; `exposedPort` is the supervisor's single-port fallback. */
function routesCard(probes, exposedPort, expUp) {
  const rows = probes.length
    ? probes.map((r) => `<tr>
            <td>${r.listening ? `<a href="${escapeHtml(r.prefix)}">${escapeHtml(r.prefix)}</a>` : `<span class="dim">${escapeHtml(r.prefix)}</span>`}</td>
            <td class="num">${r.port}</td>
            <td>${escapeHtml(r.label || "—")}</td>
            <td>${dot(r.listening)}</td>
          </tr>`).join("")
    : `<tr><td colspan="4" class="dim">No routes configured yet.</td></tr>`
  const defaultRow = exposedPort
    ? `<p class="muted">Default app port: <strong>${exposedPort}</strong> ${dot(expUp)}</p>`
    : ""
  return `<div class="card">
      <h2>Configured Routes</h2>
      <table>
        <thead><tr><th>Path</th><th>Port</th><th>Label</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${defaultRow}
    </div>`
}

function downloadsCard(downloadHref) {
  return `<div class="card">
      <h2>Downloads</h2>
      <p class="muted" style="margin-bottom:10px">
        Files staged in <code>/workspace/.oyren-deliver/</code> are available for download.
      </p>
      <a href="${escapeHtml(downloadHref)}" class="btn btn-primary">Open Downloads</a>
    </div>`
}

function logsCard(logsHref) {
  return `<div class="card">
      <h2>Logs</h2>
      <p class="muted" style="margin-bottom:10px">
        Recent server + app output — useful when a route above says "not listening" or an app won't start.
        In-memory only (resets on restart), so it won't help after a container replacement.
      </p>
      <a href="${escapeHtml(logsHref)}" class="btn btn-secondary">View Logs</a>
    </div>`
}

module.exports = { routesCard, downloadsCard, logsCard }
