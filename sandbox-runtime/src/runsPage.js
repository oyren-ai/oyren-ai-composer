// GET /_oyren/runs.html?token=<SESSION_TOKEN> — a browsable HTML panel over the in-memory detached-run
// registry (runJobs.js): every Script Runner run newest-first, each a card with its command, a status
// badge, start time + duration, and its stdout/stderr. Human-facing sibling of the JSON `/_oyren/runs`
// endpoint (runs.js) — same registry, same SESSION_TOKEN `?token=` gate — meant to be opened in a real
// browser tab or iframed by the web app. Mirrors the logs page (logs.js): dark, inline styles (no
// external assets, iframe-CSP-safe), reloads every 3s while any run is still running.
const { tokenOk, json } = require("./agentHttp")
const { jobs } = require("./sharedJobs")
const { renderCard, escapeHtml } = require("./runsCard")

function renderHtml(token, runs) {
  const anyRunning = runs.some((r) => r.status === "running")
  const cards = runs.length ? runs.map(renderCard).join("\n") : `<p class="empty-list">No script runs yet.</p>`
  const jsonHref = `/_oyren/runs?token=${encodeURIComponent(token)}`
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Oyren Runs</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; margin: 0; }
    body { min-height: 100vh; background: #0a0a12; color: #e4e4eb; padding: 24px 16px;
      font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
    header { display: flex; align-items: baseline; justify-content: space-between; max-width: 960px; margin: 0 auto 12px; }
    h1 { font-size: 20px; letter-spacing: -0.4px; }
    a { color: #93c5fd; text-decoration: none; } a:hover { text-decoration: underline; }
    .sub { color: #71717a; font-size: 13px; max-width: 960px; margin: 0 auto 16px; }
    main { max-width: 960px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
    .run { background: #0c0c14; border: 1px solid #1e1e2e; border-radius: 10px; padding: 14px; }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
    .cmd { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: #c4d0ff; word-break: break-all; }
    .meta { color: #71717a; font-size: 12.5px; margin-bottom: 10px; }
    .badge { font-size: 12px; padding: 2px 9px; border-radius: 999px; white-space: nowrap; border: 1px solid #2e2e3e; }
    .badge.running { color: #fbbf24; } .badge.ok { color: #4ade80; } .badge.fail { color: #f87171; }
    pre { background: #08080e; border: 1px solid #16161f; border-radius: 8px; padding: 12px; color: #c4d0ff;
      font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
      white-space: pre-wrap; word-break: break-all; max-height: 42vh; overflow-y: auto; }
    pre.stderr { color: #fca5a5; margin-top: 8px; } pre.empty { color: #52525b; }
    .trunc, .empty-list { color: #71717a; font-size: 12.5px; margin-top: 8px; }
  </style>
</head>
<body>
  <header>
    <h1>Oyren Runs</h1>
    <a href="${escapeHtml(jsonHref)}">json ↗</a>
  </header>
  <p class="sub">Detached script runs (newest first, in-memory — resets on restart). ${anyRunning ? "Refreshing every 3s while runs are active." : "No active runs."}</p>
  <main>${cards}</main>
  <script>
    if (${anyRunning ? "true" : "false"}) setTimeout(function () { location.reload(); }, 3000);
  </script>
</body>
</html>`
}

/** Entry from the HTTP router (route.kind === "runs-page"). */
function handleRunsPage(req, res, { runJobs = jobs } = {}) {
  if (!tokenOk(req.url)) return json(res, 401, { error: "unauthorized" })
  const token = new URL(req.url, "http://localhost").searchParams.get("token") || ""
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
  res.end(renderHtml(token, runJobs.list()))
}

module.exports = { handleRunsPage, renderHtml }
