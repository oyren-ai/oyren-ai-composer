const { test } = require("node:test")
const assert = require("node:assert")
const { ideAuth } = require("./ide")

const T = "tok-1234567890abcdef"

// A malformed percent-escape in the token segment must FAIL AUTH, never throw: an uncaught
// URIError on the HTTP path would crash the whole session runtime (WS is wrapped by safeUpgrade,
// HTTP is not). Mirrors portPath.js's guarded decode.
test("malformed percent-escapes fail auth without throwing", () => {
  assert.equal(ideAuth("/_oyren/ide/%zz/", T), false)
  assert.equal(ideAuth("/_oyren/ide/%/", T), false)
  assert.equal(ideAuth(`/_oyren/ide/%zz${T}/`, T), false)
})

// The guard falls back to the RAW segment, so a literal token that merely looks escape-ish
// still authenticates when it byte-matches.
test("valid encoded token still authenticates", () => {
  assert.equal(ideAuth(`/_oyren/ide/${encodeURIComponent(T)}/`, T), true)
})
