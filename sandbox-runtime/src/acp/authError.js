// Classify an ACP failure as "the agent wants a login" and dig out a login URL for the chat. ACP
// signals auth with error code 401 (some bridges use -32000 or just say "auth" in the message); the
// URL may ride in error.data, the message itself, or only on stderr (antigravity's bridge prints its
// remote-login link there) — scan all three, newest source first.
const URL_RE = /https?:\/\/[^\s"'<>)\]}]+/

function isAuthError(err) {
  if (!err) return false
  if (err.code === 401 || err.code === -32000) return true
  return /\bauth(entication|orization|_required)?\b|\blog ?in\b|\bunauthorized\b/i.test(String(err.message || ""))
}

/** First http(s) URL found across the error's data, its message, and the recent stderr tail. */
function findLoginUrl(err, stderrTail = "") {
  const sources = []
  if (err && err.data !== undefined) { try { sources.push(typeof err.data === "string" ? err.data : JSON.stringify(err.data)) } catch {} }
  if (err && err.message) sources.push(String(err.message))
  if (stderrTail) sources.push(String(stderrTail))
  for (const s of sources) {
    const m = s.match(URL_RE)
    if (m) return m[0]
  }
  return null
}

module.exports = { isAuthError, findLoginUrl }
