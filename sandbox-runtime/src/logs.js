// GET /_oyren/logs?token=<SESSION_TOKEN> — a small HTML viewer over the in-memory logBuffer tail
// (this process's own console output + the managed app's stdout/stderr), so a user debugging a
// container that won't come up doesn't need shell/terminal access. Polls /_oyren/logs/raw every
// few seconds to stay live. Auth reuses the SESSION_TOKEN `?token=` gate (same secret as
// /agent/message + /terminal + /_oyren/download).
// GET /_oyren/logs/raw?token=<SESSION_TOKEN> — the same tail as text/plain, for curl/copy-paste,
// and what the HTML viewer polls.
const { tokenOk, json, handleCorsOptions } = require("./agentHttp")
const { snapshot } = require("./logBuffer")
const { pathOf } = require("./routeFor")

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))

function formatLine(entry) {
  const ts = new Date(entry.t).toISOString().slice(11, 23) // HH:MM:SS.mmm
  return `[${ts}] ${entry.stream === "stderr" ? "! " : "  "}${entry.text}`
}

/** Plain-text tail: one formatted line per buffered entry. */
function renderRaw() {
  const lines = snapshot()
  return lines.length ? lines.map(formatLine).join("\n") + "\n" : "(no output yet)\n"
}

function renderHtml(token) {
  const rawHref = `/_oyren/logs/raw?token=${encodeURIComponent(token)}`
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Oyren Logs</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; margin: 0; }
    body {
      min-height: 100vh; background: #0a0a12; color: #e4e4eb;
      font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      padding: 24px 16px;
    }
    header { display: flex; align-items: baseline; justify-content: space-between; max-width: 960px; margin: 0 auto 12px; }
    h1 { font-size: 20px; letter-spacing: -0.4px; }
    a { color: #93c5fd; text-decoration: none; }
    a:hover { text-decoration: underline; }
    #log {
      max-width: 960px; margin: 0 auto; background: #0c0c14; border: 1px solid #1e1e2e; border-radius: 10px;
      padding: 14px; font: 12.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; color: #c4d0ff;
      white-space: pre-wrap; word-break: break-all; max-height: 75vh; overflow-y: auto;
    }
    .sub { color: #71717a; font-size: 13px; max-width: 960px; margin: 0 auto 12px; }
  </style>
</head>
<body>
  <header>
    <h1>Oyren Logs</h1>
    <a href="${escapeHtml(rawHref)}">raw ↗</a>
  </header>
  <p class="sub">Recent server + app output (in-memory only — resets on restart). Refreshes every 3s.</p>
  <pre id="log">${escapeHtml(renderRaw())}</pre>
  <script>
    var box = document.getElementById("log");
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
    setTimeout(poll, 3000);
  </script>
</body>
</html>`
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
