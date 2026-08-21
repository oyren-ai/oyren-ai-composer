// The dsh host's access cookie: how a browser proves it holds the session token on requests that
// cannot carry `?token=` — dsh's root-absolute assets and its two WebSockets (/api/events.mux,
// /api/events.host) build their own URLs, so only the first page load can be token-gated directly.
//
//   oyren_dsh_access = <exp>.<hex HMAC-SHA256(key = SESSION_TOKEN, "dsh|" + exp)>
//   Path=/; Secure; HttpOnly; SameSite=None; Partitioned; Max-Age=86400
//
// The value is derived from the token, never the token itself, so a leaked cookie expires and opens
// only dsh — not the terminal WS, downloads or the agent stream. SameSite=None + Partitioned is what a
// modern browser requires before it sends a cookie to an iframe on another site (the dsh host, framed
// by the Oyren app); Partitioned scopes it to that embedding, so it is not a cross-site cookie at all.
const crypto = require("crypto")

const DSH_COOKIE = "oyren_dsh_access"
const DEFAULT_TTL_SEC = 86400

function sign(sessionToken, exp) {
  return crypto.createHmac("sha256", sessionToken).update(`dsh|${exp}`).digest("hex")
}

/** Mint a cookie valid for `ttlSec` from `nowSec`: `{ value, header }`, header = the Set-Cookie line. */
function mintDshCookie(sessionToken, nowSec, ttlSec = DEFAULT_TTL_SEC) {
  const exp = Math.floor(nowSec) + ttlSec
  const value = `${exp}.${sign(sessionToken, exp)}`
  const attrs = `Path=/; Secure; HttpOnly; SameSite=None; Partitioned; Max-Age=${ttlSec}`
  return { value, header: `${DSH_COOKIE}=${value}; ${attrs}` }
}

/** The first oyren_dsh_access value in a Cookie header, or "" — other cookies are never looked at. */
function readDshCookie(cookieHeader) {
  if (typeof cookieHeader !== "string" || !cookieHeader) return ""
  for (const part of cookieHeader.split(";")) {
    const pair = part.trim()
    if (pair.startsWith(`${DSH_COOKIE}=`)) return pair.slice(DSH_COOKIE.length + 1)
  }
  return ""
}

/**
 * True only for an unexpired value whose mac matches this session's token. Fails closed on an empty
 * token (a sandbox booted without SESSION_TOKEN rejects everything). The mac is compared with
 * timingSafeEqual; the length check before it is what keeps that from throwing on garbage.
 */
function verifyDshCookie(cookieHeader, sessionToken, nowSec) {
  if (!sessionToken) return false
  const value = readDshCookie(cookieHeader)
  const m = /^(\d{1,12})\.([0-9a-f]+)$/.exec(value)
  if (!m) return false
  const [, exp, mac] = m
  if (Number(exp) <= nowSec) return false
  const expected = Buffer.from(sign(sessionToken, exp))
  const got = Buffer.from(mac)
  return got.length === expected.length && crypto.timingSafeEqual(got, expected)
}

module.exports = { DSH_COOKIE, mintDshCookie, verifyDshCookie }
