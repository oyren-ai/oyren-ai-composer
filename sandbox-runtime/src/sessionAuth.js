const crypto = require("crypto")

/**
 * Constant-time token equality, shared by every session-token gate: the `?token=` query param
 * (below), the path-segment token of the IDE (ide.js), and the port proxy (portPath.js).
 *
 * Fails closed on an empty expected token: a sandbox booted without SESSION_TOKEN must reject
 * everything rather than accept anything. The length check has to come before timingSafeEqual
 * (which throws on a mismatch) — it leaks only the token's length, a fixed-size UUID anyway.
 */
function tokenEq(got, expected) {
  if (!expected) return false
  if (typeof got !== "string" || got.length === 0) return false
  const a = Buffer.from(got)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * Constant-time check of the `?token=` query param against the session token.
 *
 * Browsers cannot set headers on an iframe src or a top-level navigation, which is why the session
 * token travels as a query param on the surfaces the user's browser reaches directly (the terminal
 * WS, the agent stream, downloads, the editor). Header-authenticated surfaces use control.js's
 * tokenOk instead.
 */
function queryTokenOk(rawUrl, expected) {
  let got
  try {
    got = new URL(rawUrl || "/", "http://localhost").searchParams.get("token")
  } catch {
    return false
  }
  return tokenEq(got === null ? "" : got, expected)
}

module.exports = { tokenEq, queryTokenOk }
