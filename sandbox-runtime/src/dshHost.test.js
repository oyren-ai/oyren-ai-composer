const { test } = require("node:test")
const assert = require("node:assert/strict")
const { dshHostFromEnv, isDshHost } = require("./dshHost")

test("prefixes the session's label with dsh- and keeps the edge domain", () => {
  assert.equal(dshHostFromEnv({ OYREN_PUBLIC_ORIGIN: "https://abc123.sandboxes.oyren.ai" }), "dsh-abc123.sandboxes.oyren.ai")
  // A path or port on the origin is not part of the hostname.
  assert.equal(dshHostFromEnv({ OYREN_PUBLIC_ORIGIN: "https://abc123.sandboxes.oyren.ai:8443/x" }), "dsh-abc123.sandboxes.oyren.ai")
  assert.equal(dshHostFromEnv({ OYREN_PUBLIC_ORIGIN: "ABC123.Sandboxes.oyren.ai" }), "dsh-abc123.sandboxes.oyren.ai")
})

test("falls back through the same env precedence as publicOrigin.js", () => {
  assert.equal(dshHostFromEnv({ PUBLIC_URL: "https://p.example.com" }), "dsh-p.example.com")
  assert.equal(dshHostFromEnv({ SANDBOX_HOSTNAME: "h.example.com" }), "dsh-h.example.com")
  assert.equal(dshHostFromEnv({ OYREN_PUBLIC_ORIGIN: "a.example.com", PUBLIC_URL: "b.example.com" }), "dsh-a.example.com")
})

test("null when no origin is known, the host has no edge domain, or the label would exceed 63 chars", () => {
  assert.equal(dshHostFromEnv({}), null)
  assert.equal(dshHostFromEnv({ OYREN_PUBLIC_ORIGIN: "localhost" }), null)
  assert.equal(dshHostFromEnv({ OYREN_PUBLIC_ORIGIN: "http://[" }), null)
  // 59 chars + "dsh-" = 63: the longest label the DNS spec allows.
  const fits = "a".repeat(59)
  assert.equal(dshHostFromEnv({ OYREN_PUBLIC_ORIGIN: `${fits}.edge.test` }), `dsh-${fits}.edge.test`)
  assert.equal(dshHostFromEnv({ OYREN_PUBLIC_ORIGIN: `${"a".repeat(60)}.edge.test` }), null)
})

test("isDshHost matches the Host header case-insensitively, ignoring any port", () => {
  const dsh = "dsh-abc123.sandboxes.oyren.ai"
  assert.equal(isDshHost({ headers: { host: "dsh-abc123.sandboxes.oyren.ai" } }, dsh), true)
  assert.equal(isDshHost({ headers: { host: "DSH-ABC123.Sandboxes.oyren.ai:443" } }, dsh), true)
  assert.equal(isDshHost({ headers: { host: "abc123.sandboxes.oyren.ai" } }, dsh), false)
  assert.equal(isDshHost({ headers: { host: "xdsh-abc123.sandboxes.oyren.ai" } }, dsh), false)
})

test("isDshHost is false without a Host header or without a dsh host at all", () => {
  assert.equal(isDshHost({ headers: {} }, "dsh-abc123.sandboxes.oyren.ai"), false)
  assert.equal(isDshHost({ headers: { host: "dsh-abc123.sandboxes.oyren.ai" } }, null), false)
  // Loopback callers (the oyren CLI, the editor's extension host) never look like the dsh host.
  assert.equal(isDshHost({ headers: { host: "127.0.0.1:8080" } }, "dsh-abc123.sandboxes.oyren.ai"), false)
})

// Parity with dsh_host() in dsh-web.sh, whose `.* | *. | *..*` guard refuses these: both sides must
// derive the SAME hostname (or agree there is none), else the router waits on a host nobody registered.
test("null when the hostname ends with a dot or contains an empty label ('..')", () => {
  assert.equal(dshHostFromEnv({ OYREN_PUBLIC_ORIGIN: "https://abc." }), null)
  assert.equal(dshHostFromEnv({ SANDBOX_HOSTNAME: "abc.sandboxes.oyren.ai." }), null)
  assert.equal(dshHostFromEnv({ OYREN_PUBLIC_ORIGIN: "https://a..b" }), null)
  assert.equal(dshHostFromEnv({ PUBLIC_URL: "abc..sandboxes.oyren.ai" }), null)
})
