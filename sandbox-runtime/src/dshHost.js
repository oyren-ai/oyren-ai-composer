// The DeepSeek Harness hostname: "dsh-<label>.<edge domain>", derived from the session's public host.
//
// dsh's assets are root-absolute, so it can only live at "/" of SOME origin — and "/" of the session
// origin is the user's app. The orchestrator therefore registers a SECOND hostname per Codespace,
// "dsh-" + the session's label, pointing at this same router, and router.js/upgrade.js route by Host.
// Both sides derive the name with this exact rule, so the hostname never needs to travel as config.
//
// Read from the same env the session host comes from (OYREN_PUBLIC_ORIGIN, then PUBLIC_URL, then
// SANDBOX_HOSTNAME — publicOrigin.js's precedence) because that is all the orchestrator delivers.
// null when none is set (an old orchestrator, local dev), when the host has no edge domain to hang
// the label off, or when "dsh-" would push the label past DNS's 63-character limit.
const MAX_LABEL = 63

function dshHostFromEnv(env = process.env) {
  const raw = env.OYREN_PUBLIC_ORIGIN || env.PUBLIC_URL || env.SANDBOX_HOSTNAME || ""
  if (!raw) return null
  let hostname
  try {
    hostname = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname
  } catch {
    return null
  }
  const dot = hostname.indexOf(".")
  if (dot <= 0) return null
  const label = `dsh-${hostname.slice(0, dot)}`
  if (label.length > MAX_LABEL) return null
  return label + hostname.slice(dot)
}

// Computed once at boot, like config.js: the env cannot change under a running server.
const DSH_HOST = dshHostFromEnv()

/** Does this request address the dsh host? Host is compared without its port, case-insensitively. */
function isDshHost(req, dshHost = DSH_HOST) {
  if (!dshHost) return false
  const host = req.headers && req.headers.host
  if (typeof host !== "string" || !host) return false
  return host.split(":")[0].toLowerCase() === dshHost.toLowerCase()
}

module.exports = { DSH_HOST, dshHostFromEnv, isDshHost }
