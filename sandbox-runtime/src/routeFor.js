// Pure request-dispatch decisions, keyed only on the URL path so they're trivially unit-testable.
// Reserved namespaces: `/_oyren/*` (platform-internal: health + control) never collide with a
// user's app, and `/how-to-deploy` + `/terminal` + `/agent/message` + `/tmux` are the user-facing
// reserved paths.

function pathOf(rawUrl) {
  return (rawUrl || "/").split("?")[0]
}

function isUnder(path, base) {
  return path === base || path.startsWith(base + "/")
}

/** Classify a normal HTTP request. "app" means: proxy to the user app if exposed, else the page. */
function routeFor(rawUrl) {
  const path = pathOf(rawUrl)
  if (path === "/_oyren/health") return { kind: "health" }
  if (isUnder(path, "/_oyren/control")) return { kind: "control" }
  if (isUnder(path, "/_oyren/download")) return { kind: "download" }
  if (isUnder(path, "/_oyren/logs")) return { kind: "logs" }
  if (path === "/_oyren/runs.html") return { kind: "runs-page" }
  if (isUnder(path, "/_oyren/runs")) return { kind: "runs" }
  if (isUnder(path, "/_oyren/gateway")) return { kind: "gateway" }
  // The browser IDE. Reserved rather than served from a "/" route so that a format app's
  // `oyren route add / <port>` cannot evict it mid-session — see ide.js for the full reasoning.
  if (isUnder(path, "/_oyren/ide")) return { kind: "ide" }
  // Session-token-gated proxy to any loopback port — see portProxy.js for the URL contract.
  if (isUnder(path, "/_oyren/port")) return { kind: "port" }
  // Image → clipboard injection for the streamed-Zed session (see zedClipboard.js). MUST precede the
  // "/_oyren/zed" test: "/_oyren/zed-clipboard" is not under "/_oyren/zed" (no "zed/" boundary), but
  // ordering it first keeps the two intents visibly distinct.
  if (isUnder(path, "/_oyren/zed-clipboard")) return { kind: "zed-clipboard" }
  // The streamed-Zed (KasmVNC) stream — see zedProxy.js for the URL contract.
  if (isUnder(path, "/_oyren/zed")) return { kind: "zed" }
  // The in-VM browser's stream, same contract against its own port — see browserProxy.js.
  if (isUnder(path, "/_oyren/browser")) return { kind: "browser" }
  if (isUnder(path, "/agent/current")) return { kind: "agent-current" }
  if (isUnder(path, "/agent/stream")) return { kind: "agent-stream" }
  if (isUnder(path, "/agent/interrupt")) return { kind: "agent-interrupt" }
  if (isUnder(path, "/agent/models")) return { kind: "agent-models" }
  if (isUnder(path, "/agent/model")) return { kind: "agent-model" }
  if (isUnder(path, "/agent/message")) return { kind: "agent" }
  // The tmux bridge (tmuxBridge.js) — one kind for the whole prefix; the handler dispatches
  // /tmux/panes[/:id/(screen|input)] itself, since routeFor stays parameter-free.
  if (isUnder(path, "/tmux")) return { kind: "tmux" }
  if (isUnder(path, "/how-to-deploy")) return { kind: "static" }
  return { kind: "app" }
}

/** Classify a WebSocket upgrade. "terminal" is the token-gated PTY; "app" proxies the user app's WS. */
function wsRouteFor(rawUrl) {
  const path = pathOf(rawUrl)
  if (isUnder(path, "/terminal")) return { kind: "terminal" }
  // The editor's own WebSocket (workbench ↔ extension host) lives under its base path.
  if (isUnder(path, "/_oyren/ide")) return { kind: "ide" }
  // The port proxy carries WS upgrades too (dev-server HMR sockets) — before the app fallback.
  if (isUnder(path, "/_oyren/port")) return { kind: "port" }
  // The zed stream is WebSocket-first (KasmVNC) — its WS side matters more than its HTTP side.
  if (isUnder(path, "/_oyren/zed")) return { kind: "zed" }
  // …and so is the browser stream.
  if (isUnder(path, "/_oyren/browser")) return { kind: "browser" }
  return { kind: "app" }
}

module.exports = { routeFor, wsRouteFor, pathOf }
