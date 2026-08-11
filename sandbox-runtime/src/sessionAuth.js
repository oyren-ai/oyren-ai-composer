const crypto = require("crypto")

/**
 * Constant-time check of the `?token=` query param against the session token.
 *
 * Browsers cannot set headers on an iframe src or a top-level navigation, which is why the session
 * token travels as a query param on the surfaces the user's browser reaches directly (the terminal
 * WS, the agent stream, downloads, the editor). Header-authenticated surfaces use control.js's
 * tokenOk instead.
 *
 * Fails closed on an empty expected token: a sandbox booted without SESSION_TOKEN must reject
 * everything rather than accept anything.
 */
function queryTokenOk(rawUrl, expected) {
  if (!expected) return false
  let got
  try {
    got = new URL(rawUrl || "/", "http://localhost").searchParams.get("token")
  } catch {
    return false
  }
  if (typeof got !== "string") return false
  const a = Buffer.from(got)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on a length mismatch, so the length check has to come first — it leaks
  // only the token's length, which is a fixed-size UUID anyway.
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

module.exports = { queryTokenOk }
