// Pure request-dispatch decisions, keyed only on the URL path so they're trivially unit-testable.
// Reserved namespaces: `/_oyren/*` (platform-internal: health + control) never collide with a
// user's app, and `/how-to-deploy` + `/terminal` + `/agent/message` are the user-facing reserved paths.

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
  if (isUnder(path, "/agent/current")) return { kind: "agent-current" }
  if (isUnder(path, "/agent/stream")) return { kind: "agent-stream" }
  if (isUnder(path, "/agent/interrupt")) return { kind: "agent-interrupt" }
  if (isUnder(path, "/agent/models")) return { kind: "agent-models" }
  if (isUnder(path, "/agent/model")) return { kind: "agent-model" }
  if (isUnder(path, "/agent/message")) return { kind: "agent" }
  if (isUnder(path, "/how-to-deploy")) return { kind: "static" }
  return { kind: "app" }
}

/** Classify a WebSocket upgrade. "terminal" is the token-gated PTY; "app" proxies the user app's WS. */
function wsRouteFor(rawUrl) {
  const path = pathOf(rawUrl)
  if (isUnder(path, "/terminal")) return { kind: "terminal" }
  return { kind: "app" }
}

module.exports = { routeFor, wsRouteFor, pathOf }
