const { test } = require("node:test")
const assert = require("node:assert/strict")
const { publicOrigin } = require("./publicOrigin")

const S = "session-token"

test("reads OYREN_PUBLIC_ORIGIN and normalizes it to a bare origin", () => {
  assert.equal(publicOrigin({ SESSION_TOKEN: S, OYREN_PUBLIC_ORIGIN: "https://s.oyren.app" }), "https://s.oyren.app")
  assert.equal(publicOrigin({ SESSION_TOKEN: S, OYREN_PUBLIC_ORIGIN: "https://s.oyren.app/some/path" }), "https://s.oyren.app")
})

test("falls back to PUBLIC_URL, then SANDBOX_HOSTNAME; bare hosts assume https", () => {
  assert.equal(publicOrigin({ SESSION_TOKEN: S, PUBLIC_URL: "https://p.example.com" }), "https://p.example.com")
  assert.equal(publicOrigin({ SESSION_TOKEN: S, SANDBOX_HOSTNAME: "h.example.com" }), "https://h.example.com")
  assert.equal(publicOrigin({ SESSION_TOKEN: S, OYREN_PUBLIC_ORIGIN: "a.example.com", PUBLIC_URL: "https://b.example.com" }), "https://a.example.com")
})

test("empty when no host env exists — absence IS the capability signal", () => {
  assert.equal(publicOrigin({ SESSION_TOKEN: S }), "")
})

test("empty without SESSION_TOKEN — port-proxy URLs would only 401", () => {
  assert.equal(publicOrigin({ OYREN_PUBLIC_ORIGIN: "https://s.oyren.app" }), "")
  assert.equal(publicOrigin({ SESSION_TOKEN: "", SANDBOX_HOSTNAME: "h.example.com" }), "")
})

test("garbage never throws — it just withholds the origin", () => {
  assert.equal(publicOrigin({ SESSION_TOKEN: S, OYREN_PUBLIC_ORIGIN: "http://[" }), "")
  assert.equal(publicOrigin({ SESSION_TOKEN: S, OYREN_PUBLIC_ORIGIN: "not a url at all" }), "")
})
