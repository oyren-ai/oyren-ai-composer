// GET /_oyren/logs?token=<SESSION_TOKEN> — a small HTML viewer over the in-memory logBuffer tail
// (this process's own console output + the managed app's stdout/stderr), so a user debugging a
// Codespace that won't come up doesn't need shell/terminal access. Polls /_oyren/logs/raw every
// few seconds to stay live. Auth reuses the SESSION_TOKEN `?token=` gate (same secret as
// /agent/message + /terminal + /_oyren/download).
// GET /_oyren/logs/raw?token=<SESSION_TOKEN> — the same tail as text/plain, for curl/copy-paste,
// and what the HTML viewer polls.
const { tokenOk, json, handleCorsOptions } = require("./agentHttp")
const { snapshot } = require("./logBuffer")
const { pathOf } = require("./routeFor")
const { renderPage, escapeHtml } = require("./pageShell")

function formatLine(entry) {
  const ts = new Date(entry.t).toISOString().slice(11, 23) // HH:MM:SS.mmm
  return `[${ts}] ${entry.stream === "stderr" ? "! " : "  "}${entry.text}`
}

/** Plain-text tail: one formatted line per buffered entry. */
function renderRaw() {
  const lines = snapshot()
  return lines.length ? lines.map(formatLine).join("\n") + "\n" : "(no output yet)\n"
}

// On top of the shared shell (pageShell.js): a wider column than the gateway's, and a log box that
// wraps long lines and scrolls inside the page rather than growing it.
const LOGS_CSS = `
    header, .sub, #log { max-width: 960px; margin-left: auto; margin-right: auto; }
    header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
    #log { white-space: pre-wrap; word-break: break-all; max-height: 75vh; overflow-y: auto; line-height: 1.6; }`

function renderHtml(token) {
  const rawHref = `/_oyren/logs/raw?token=${encodeURIComponent(token)}`
  const body = `  <header>
    <h1>Oyren Logs</h1>
    <a href="${escapeHtml(rawHref)}">raw ↗</a>
  </header>
  <p class="sub">Recent server + app output (in-memory only — resets on restart). Refreshes every 3s.</p>
  <pre id="log">${escapeHtml(renderRaw())}</pre>`
  const script = `    var box = document.getElementById("log");
    var pinnedToBottom = true;
    box.addEventListener("scroll", function () {
      pinnedToBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
    });
    box.scrollTop = box.scrollHeight;
    function poll() {
      fetch(${JSON.stringify(rawHref)}).then(function (res) {
        return res.ok ? res.text() : null;
      }).then(function (text) {
        if (text == null) return;
        box.textContent = text;
        if (pinnedToBottom) box.scrollTop = box.scrollHeight;
      }).catch(function () {}).finally(function () {
        setTimeout(poll, 3000);
      });
    }
    setTimeout(poll, 3000);`
  return renderPage({ title: "Oyren Logs", body, extraCss: LOGS_CSS, script })
}

/** Entry from the HTTP router (route.kind === "logs"). Handles both the HTML page and /raw. */
function handleLogs(req, res) {
  // Handle CORS preflight for cross-origin fetch from Oyren dashboard
  if (req.method === "OPTIONS") return handleCorsOptions(res)
  if (!tokenOk(req.url)) return json(res, 401, { error: "unauthorized" }, { allowCors: true })
  const url = new URL(req.url, "http://localhost")
  if (pathOf(req.url).endsWith("/raw")) {
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    })
    return res.end(renderRaw())
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
  res.end(renderHtml(url.searchParams.get("token") || ""))
}

module.exports = { handleLogs, renderRaw, renderHtml, formatLine }
