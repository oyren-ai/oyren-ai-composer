// The session's public origin ("https://<session-host>"), when knowable.
//
// The container cannot observe its own public hostname: route/list callers are loopback (the
// `oyren` CLI, the editor's extension host), so the Host header says 127.0.0.1; TLS terminates on
// the edge, another machine; and no baked env carries the host today. The orchestrator is the one
// party that knows it, so this reads the env it can deliver via CONTAINER_ENV_B64 —
// OYREN_PUBLIC_ORIGIN (canonical), with PUBLIC_URL / SANDBOX_HOSTNAME accepted as fallbacks.
//
// Returning "" is a deliberate signal, not a failure: route/list omits `origin` entirely when this
// is empty, and consumers (the editor's Oyren Preview) use the key's PRESENCE as their capability
// probe for the /_oyren/port proxy. That is also why SESSION_TOKEN is required — the port proxy
// fails closed without it, so advertising an origin then would promise URLs that can only 401.
function publicOrigin(env = process.env) {
  if (!env.SESSION_TOKEN) return ""
  const raw = env.OYREN_PUBLIC_ORIGIN || env.PUBLIC_URL || env.SANDBOX_HOSTNAME || ""
  if (!raw) return ""
  try {
    // A bare hostname means https — the edge only serves TLS. `.origin` drops any stray path.
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).origin
  } catch {
    return ""
  }
}

module.exports = { publicOrigin }
