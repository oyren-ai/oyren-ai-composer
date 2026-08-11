const { test } = require("node:test")
const assert = require("node:assert/strict")
const { queryTokenOk } = require("./sessionAuth")

const TOKEN = "11111111-2222-4333-8444-555555555555"

test("accepts the matching token", () => {
  assert.equal(queryTokenOk(`/_oyren/gateway?token=${TOKEN}`, TOKEN), true)
})

test("rejects a wrong, absent, or empty token", () => {
  assert.equal(queryTokenOk("/_oyren/gateway?token=nope", TOKEN), false)
  assert.equal(queryTokenOk("/_oyren/gateway", TOKEN), false)
  assert.equal(queryTokenOk("/_oyren/gateway?token=", TOKEN), false)
})

test("fails closed when the sandbox has no session token", () => {
  // A sandbox booted without SESSION_TOKEN must reject everything, not accept anything.
  assert.equal(queryTokenOk("/_oyren/gateway?token=anything", ""), false)
  assert.equal(queryTokenOk("/_oyren/gateway", ""), false)
  assert.equal(queryTokenOk("/_oyren/gateway?token=", ""), false)
})

test("a length mismatch does not throw (timingSafeEqual would)", () => {
  assert.equal(queryTokenOk("/_oyren/gateway?token=short", TOKEN), false)
  assert.equal(queryTokenOk(`/_oyren/gateway?token=${TOKEN}extra`, TOKEN), false)
})

test("survives a malformed url", () => {
  assert.equal(queryTokenOk("http://[", TOKEN), false)
  assert.equal(queryTokenOk(undefined, TOKEN), false)
})

test("reads the token regardless of query position", () => {
  assert.equal(queryTokenOk(`/_oyren/gateway?a=1&token=${TOKEN}&b=2`, TOKEN), true)
})
