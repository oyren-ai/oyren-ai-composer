const { test } = require("node:test")
const assert = require("node:assert/strict")
const { PORT_PREFIX, parsePortPath, portAuth } = require("./portPath")

const T = "11111111-2222-4333-8444-555555555555"

test("parses token, port, and the prefix-stripped downstream path", () => {
  const p = parsePortPath(`${PORT_PREFIX}/${T}/3000/assets/app.js`)
  assert.equal(p.token, T)
  assert.equal(p.port, 3000)
  assert.equal(p.downstream, "/assets/app.js")
  assert.equal(p.needsSlash, false)
})

test("preserves the query string verbatim on the downstream path", () => {
  const p = parsePortPath(`${PORT_PREFIX}/${T}/3000/search?q=a+b&x=%2F`)
  assert.equal(p.downstream, "/search?q=a+b&x=%2F")
})

test("a trailing-slash base maps to downstream / and needs no redirect", () => {
  const p = parsePortPath(`${PORT_PREFIX}/${T}/3000/`)
  assert.equal(p.downstream, "/")
  assert.equal(p.needsSlash, false)
})

test("the bare …/<port> form needs a slash redirect, query intact", () => {
  const p = parsePortPath(`${PORT_PREFIX}/${T}/3000?a=1`)
  assert.equal(p.needsSlash, true)
  assert.equal(p.port, 3000)
  assert.equal(p.downstream, "/?a=1")
})

test("non-digit, out-of-range, or missing port segments parse as port 0", () => {
  assert.equal(parsePortPath(`${PORT_PREFIX}/${T}/abc/`).port, 0)
  assert.equal(parsePortPath(`${PORT_PREFIX}/${T}/30a0/`).port, 0)
  assert.equal(parsePortPath(`${PORT_PREFIX}/${T}/-1/`).port, 0)
  assert.equal(parsePortPath(`${PORT_PREFIX}/${T}/0/`).port, 0)
  assert.equal(parsePortPath(`${PORT_PREFIX}/${T}/70000/`).port, 0)
  assert.equal(parsePortPath(`${PORT_PREFIX}/${T}`).port, 0)
})

test("paths outside the prefix are null — /_oyren/portxyz is someone's app", () => {
  assert.equal(parsePortPath("/_oyren/portxyz/t/3000/"), null)
  assert.equal(parsePortPath("/app"), null)
  assert.equal(parsePortPath(undefined), null)
})

test("a percent-encoded token segment is decoded; malformed escapes fall through, not throw", () => {
  assert.equal(parsePortPath(`${PORT_PREFIX}/a%20b/3000/`).token, "a b")
  assert.equal(parsePortPath(`${PORT_PREFIX}/%zz/3000/`).token, "%zz")
})

test("portAuth accepts only the session token and fails closed without one", () => {
  assert.equal(portAuth(T, T), true)
  assert.equal(portAuth("nope", T), false)
  assert.equal(portAuth(T, ""), false)
  assert.equal(portAuth("anything", ""), false)
})

test("portAuth constant-time paths don't throw on a length mismatch", () => {
  assert.equal(portAuth("short", T), false)
  assert.equal(portAuth(T + "x", T), false)
  assert.equal(portAuth("", T), false)
})
