const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { Routes, normalizePrefix, normalizeRoute, ROUTES_FILE } = require("./routes")

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-routes-"))
  return dir
}

// --- normalizePrefix ---

test("normalizePrefix adds leading slash", () => {
  assert.equal(normalizePrefix("studio"), "/studio")
})

test("normalizePrefix strips trailing slash", () => {
  assert.equal(normalizePrefix("/studio/"), "/studio")
})

test("normalizePrefix keeps root as /", () => {
  assert.equal(normalizePrefix("/"), "/")
})

test("normalizePrefix handles empty string", () => {
  assert.equal(normalizePrefix(""), "/")
})

// --- normalizeRoute ---

test("normalizeRoute returns normalized route object", () => {
  const r = normalizeRoute({ prefix: "studio/", port: "3000", label: "Studio" })
  assert.deepEqual(r, { prefix: "/studio", port: 3000, label: "Studio" })
})

test("normalizeRoute returns null for missing port", () => {
  assert.equal(normalizeRoute({ prefix: "/" }), null)
})

test("normalizeRoute returns null for port 0", () => {
  assert.equal(normalizeRoute({ prefix: "/", port: 0 }), null)
})

test("normalizeRoute returns null for non-object", () => {
  assert.equal(normalizeRoute("bad"), null)
  assert.equal(normalizeRoute(null), null)
})

test("normalizeRoute omits label when empty", () => {
  const r = normalizeRoute({ prefix: "/", port: 3000 })
  assert.deepEqual(r, { prefix: "/", port: 3000 })
  assert.ok(!("label" in r))
})

// --- Routes class ---

test("Routes starts empty when no config file exists", () => {
  const routes = new Routes(tmpDir())
  assert.deepEqual(routes.list(), [])
})

test("Routes.add creates the config file and persists a route", () => {
  const dir = tmpDir()
  const routes = new Routes(dir)
  routes.add("/studio", 3000, "Remotion Studio")
  assert.deepEqual(routes.list(), [{ prefix: "/studio", port: 3000, label: "Remotion Studio" }])

  // Verify it was persisted
  const data = JSON.parse(fs.readFileSync(path.join(dir, ROUTES_FILE), "utf8"))
  assert.equal(data.routes.length, 1)
  assert.equal(data.routes[0].port, 3000)
})

test("Routes.add replaces an existing route with the same prefix", () => {
  const dir = tmpDir()
  const routes = new Routes(dir)
  routes.add("/studio", 3000, "Old")
  routes.add("/studio", 4000, "New")
  assert.equal(routes.list().length, 1)
  assert.equal(routes.list()[0].port, 4000)
  assert.equal(routes.list()[0].label, "New")
})

test("Routes.add normalizes the prefix", () => {
  const routes = new Routes(tmpDir())
  routes.add("studio/", 3000)
  assert.equal(routes.list()[0].prefix, "/studio")
})

test("Routes.remove removes a route and returns true", () => {
  const routes = new Routes(tmpDir())
  routes.add("/studio", 3000)
  routes.add("/api", 3001)
  assert.equal(routes.remove("/studio"), true)
  assert.equal(routes.list().length, 1)
  assert.equal(routes.list()[0].prefix, "/api")
})

test("Routes.remove returns false when prefix not found", () => {
  const routes = new Routes(tmpDir())
  assert.equal(routes.remove("/nope"), false)
})

test("Routes.match returns the longest matching prefix", () => {
  const routes = new Routes(tmpDir())
  routes.add("/", 3000, "Default")
  routes.add("/api", 3001, "API")
  routes.add("/api/v2", 3002, "API v2")

  const m1 = routes.match("/api/v2/users")
  assert.equal(m1.route.port, 3002)
  assert.equal(m1.downstream, "/users")

  const m2 = routes.match("/api/health")
  assert.equal(m2.route.port, 3001)
  assert.equal(m2.downstream, "/health")

  const m3 = routes.match("/other")
  assert.equal(m3.route.port, 3000)
  assert.equal(m3.downstream, "/other") // catch-all does not strip
})

test("Routes.match returns null when no routes are configured", () => {
  const routes = new Routes(tmpDir())
  assert.equal(routes.match("/anything"), null)
})

test("Routes.match strips the prefix for non-root routes", () => {
  const routes = new Routes(tmpDir())
  routes.add("/studio", 3000)
  const m = routes.match("/studio/bundle.js?v=1")
  assert.equal(m.route.port, 3000)
  assert.equal(m.downstream, "/bundle.js?v=1")
})

test("Routes.match exact prefix match (no trailing content)", () => {
  const routes = new Routes(tmpDir())
  routes.add("/studio", 3000)
  const m = routes.match("/studio")
  assert.equal(m.downstream, "/")
})

test("Routes.match root route preserves the full path", () => {
  const routes = new Routes(tmpDir())
  routes.add("/", 3000)
  const m = routes.match("/foo/bar?x=1")
  assert.equal(m.downstream, "/foo/bar?x=1")
})

test("Routes loads from an existing config file", () => {
  const dir = tmpDir()
  fs.writeFileSync(
    path.join(dir, ROUTES_FILE),
    JSON.stringify({ routes: [{ prefix: "/app", port: 4000, label: "My App" }] }),
  )
  const routes = new Routes(dir)
  assert.equal(routes.list().length, 1)
  assert.equal(routes.list()[0].label, "My App")
})

test("Routes ignores invalid entries in the config file", () => {
  const dir = tmpDir()
  fs.writeFileSync(
    path.join(dir, ROUTES_FILE),
    JSON.stringify({ routes: [{ prefix: "/ok", port: 3000 }, "bad", { prefix: "/no-port" }, null] }),
  )
  const routes = new Routes(dir)
  assert.equal(routes.list().length, 1)
  assert.equal(routes.list()[0].prefix, "/ok")
})

test("Routes handles malformed JSON gracefully", () => {
  const dir = tmpDir()
  fs.writeFileSync(path.join(dir, ROUTES_FILE), "not json{{{")
  const routes = new Routes(dir)
  assert.deepEqual(routes.list(), [])
})
