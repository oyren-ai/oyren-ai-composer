// The static cards of the gateway page: how an agent adds routes, and every path the runtime
// reserves for itself. The reserved list mirrors routeFor.js — when a kind is added there, add its
// row here, or the page will keep telling agents a path is free when it is not.
const { escapeHtml } = require("./pageShell")

const RESERVED = [
  ["/_oyren/gateway", "This page"],
  ["/_oyren/download", "Download staged deliverables"],
  ["/_oyren/logs", "Recent server + app logs"],
  ["/_oyren/health", "Health check (always 200)"],
  ["/_oyren/control/*", "Control API (authenticated)"],
  ["/terminal", "WebSocket terminal"],
  ["/agent/message", "Headless agent chat"],
]

function howToCard() {
  return `<div class="card">
      <h2>How to add routes</h2>
      <p class="muted">
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
    </div>`
}

function reservedCard() {
  const rows = RESERVED.map(
    ([path, purpose]) => `<tr><td><code>${escapeHtml(path)}</code></td><td>${escapeHtml(purpose)}</td></tr>`,
  ).join("\n          ")
  return `<div class="card">
      <h2>Reserved endpoints</h2>
      <table>
        <thead><tr><th>Path</th><th>Purpose</th></tr></thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>`
}

module.exports = { howToCard, reservedCard, RESERVED }
