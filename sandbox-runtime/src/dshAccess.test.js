const { test } = require("node:test")
const assert = require("node:assert/strict")
const crypto = require("crypto")
const { DSH_COOKIE, mintDshCookie, verifyDshCookie } = require("./dshAccess")

const S = "11111111-2222-4333-8444-555555555555"
const NOW = 1_700_000_000

test("mints <exp>.<hmac> keyed by the session token, with the partitioned third-party attributes", () => {
  const { value, header } = mintDshCookie(S, NOW)
  const mac = crypto.createHmac("sha256", S).update(`dsh|${NOW + 86400}`).digest("hex")
  assert.equal(value, `${NOW + 86400}.${mac}`)
  // The dsh UI is an iframe on a different site: SameSite=None + Partitioned is what lets a modern
  // browser send the cookie there at all, and HttpOnly keeps dsh's own scripts from reading it.
  assert.equal(header, `${DSH_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=None; Partitioned; Max-Age=86400`)
  assert.equal(DSH_COOKIE, "oyren_dsh_access")
})

test("a minted cookie verifies until it expires, then not", () => {
  const { value } = mintDshCookie(S, NOW)
  assert.equal(verifyDshCookie(`${DSH_COOKIE}=${value}`, S, NOW), true)
  assert.equal(verifyDshCookie(`${DSH_COOKIE}=${value}`, S, NOW + 86399), true)
  assert.equal(verifyDshCookie(`${DSH_COOKIE}=${value}`, S, NOW + 86400), false)
  // A custom ttl moves the expiry with it.
  const short = mintDshCookie(S, NOW, 60).value
  assert.equal(verifyDshCookie(`${DSH_COOKIE}=${short}`, S, NOW + 59), true)
  assert.equal(verifyDshCookie(`${DSH_COOKIE}=${short}`, S, NOW + 60), false)
})

test("reads only the oyren_dsh_access cookie out of a full Cookie header", () => {
  const { value } = mintDshCookie(S, NOW)
  assert.equal(verifyDshCookie(`theme=dark; ${DSH_COOKIE}=${value}; other=${value}`, S, NOW), true)
  assert.equal(verifyDshCookie(`theme=dark; other=${value}`, S, NOW), false)
  assert.equal(verifyDshCookie(`x${DSH_COOKIE}=${value}`, S, NOW), false)
  assert.equal(verifyDshCookie(undefined, S, NOW), false)
  assert.equal(verifyDshCookie("", S, NOW), false)
})

test("a tampered value is rejected: wrong mac, pushed-out expiry, another session's key", () => {
  const { value } = mintDshCookie(S, NOW)
  const [exp, mac] = value.split(".")
  const flipped = (mac[0] === "0" ? "1" : "0") + mac.slice(1)
  assert.equal(verifyDshCookie(`${DSH_COOKIE}=${exp}.${flipped}`, S, NOW), false)
  assert.equal(verifyDshCookie(`${DSH_COOKIE}=${exp + 1}.${mac}`, S, NOW), false)
  assert.equal(verifyDshCookie(`${DSH_COOKIE}=${value}`, "other-session", NOW), false)
  assert.equal(verifyDshCookie(`${DSH_COOKIE}=${value}`, "", NOW), false) // no token ⇒ fail closed
})

test("malformed values never throw and never verify", () => {
  for (const v of ["", "garbage", "123", `${NOW + 99}.`, `${NOW + 99}.zz`, `.abc`, "a.b.c", `${NOW + 99}.${"0".repeat(63)}`]) {
    assert.equal(verifyDshCookie(`${DSH_COOKIE}=${v}`, S, NOW), false, v)
  }
})

test("the mac is compared with timingSafeEqual, not ===", (t) => {
  const { value } = mintDshCookie(S, NOW)
  const calls = []
  const real = crypto.timingSafeEqual
  t.after(() => { crypto.timingSafeEqual = real })
  crypto.timingSafeEqual = (a, b) => { calls.push([a.length, b.length]); return real(a, b) }
  assert.equal(verifyDshCookie(`${DSH_COOKIE}=${value}`, S, NOW), true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], calls[0][1])
})
