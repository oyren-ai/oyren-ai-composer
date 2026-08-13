// Pure parsing + auth for the session-token-gated port proxy at /_oyren/port — kept free of any
// http machinery so the URL contract is trivially unit-testable. portProxy.js owns the wire side.
const { tokenEq } = require("./sessionAuth")

const PORT_PREFIX = "/_oyren/port"

// The token is a path segment, so it can arrive percent-encoded. A malformed escape can't match
// anything anyway, so it falls through to the raw string and fails the constant-time compare.
const decode = (s) => { try { return decodeURIComponent(s) } catch { return s } }

/**
 * Parse `/_oyren/port/<token>/<port>/<rest>?<query>`.
 *
 * Returns null when rawUrl is not under PORT_PREFIX at all. Otherwise:
 *  - token: the (decoded) token segment, "" when missing — portAuth() rejects "".
 *  - port: the numeric port when the segment is all-digits 1..65535, else 0 (caller 400s).
 *  - downstream: "/<rest>" with the query preserved verbatim — the proxied path once the
 *    3-segment prefix is stripped.
 *  - needsSlash: true for the bare `…/<port>` form (no rest, no trailing slash) — the caller
 *    302s to `…/<port>/` so the app's relative asset URLs resolve under the prefix.
 */
function parsePortPath(rawUrl) {
  const raw = String(rawUrl || "/")
  const qi = raw.indexOf("?")
  const path = qi === -1 ? raw : raw.slice(0, qi)
  const query = qi === -1 ? "" : raw.slice(qi) // "?…", carried verbatim onto downstream
  if (path !== PORT_PREFIX && !path.startsWith(PORT_PREFIX + "/")) return null
  const segs = path.split("/") // ["", "_oyren", "port", "<token>", "<port>", ...rest]
  const token = decode(segs[3] || "")
  const portSeg = segs[4] || ""
  const port = /^[0-9]+$/.test(portSeg) && Number(portSeg) >= 1 && Number(portSeg) <= 65535 ? Number(portSeg) : 0
  const needsSlash = segs.length === 5 // exactly "…/<token>/<port>" — no rest, no trailing slash
  const downstream = "/" + segs.slice(5).join("/") + query
  return { token, port, downstream, needsSlash }
}

/** Constant-time gate for the token segment — same approach and secret as /_oyren/ide (ide.js). */
function portAuth(token, sessionToken) {
  return tokenEq(token, sessionToken)
}

module.exports = { PORT_PREFIX, parsePortPath, portAuth }
