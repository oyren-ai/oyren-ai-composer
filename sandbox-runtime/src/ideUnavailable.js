// Served when the IDE proxy cannot reach openvscode-server (crashed, mid-restart, or hung while the
// watchdog recycles it). The old plain-text 503 rendered as a blank white page inside the Editor
// iframe and never retried — the user stayed on white even after the editor came back. This page
// reloads itself every few seconds (meta refresh, so it needs no JS), and the reload lands on the
// workbench as soon as the editor is listening again — the iframe recovers with no user action.
const RETRY_SECONDS = 3

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="${RETRY_SECONDS}">
<title>Editor restarting…</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    background: #0b0b0d; color: #a1a1aa;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .box { text-align: center; }
  .spin {
    width: 28px; height: 28px; margin: 0 auto 14px;
    border: 3px solid #27272a; border-top-color: #d3f261;
    border-radius: 50%; animation: r 0.9s linear infinite;
  }
  @keyframes r { to { transform: rotate(360deg); } }
  h1 { font-size: 15px; font-weight: 500; color: #e4e4e7; margin: 0 0 4px; }
  p { margin: 0; font-size: 13px; }
</style>
</head>
<body>
  <div class="box">
    <div class="spin"></div>
    <h1>Editor is restarting</h1>
    <p>Reconnecting automatically — no need to reload.</p>
  </div>
</body>
</html>
`

/** 503 + self-refreshing HTML; no-store so the browser never caches the outage for the IDE URL. */
function serveIdeUnavailable(res) {
  // proxyHttp can fail after the upstream response started; headers are already on the wire then,
  // so just close the stream — the workbench's own reconnect handles a mid-stream drop.
  if (res.headersSent) return res.end()
  res.writeHead(503, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "retry-after": String(RETRY_SECONDS),
  })
  res.end(PAGE)
}

module.exports = { serveIdeUnavailable, RETRY_SECONDS }
