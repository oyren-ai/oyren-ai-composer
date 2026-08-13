const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { routeAction } = require("./controlRoutes")
const { Routes } = require("./routes")

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "oyren-croutes-"))

test("route/list carries `origin` when the public origin is derivable", () => {
  const routes = new Routes(tmp())
  routes.add("/app", 3000, "App")
  const env = { SESSION_TOKEN: "t", OYREN_PUBLIC_ORIGIN: "https://s.oyren.app" }
  const r = routeAction("route/list", {}, { routes, env })
  assert.equal(r.status, 200)
  assert.equal(r.payload.origin, "https://s.oyren.app")
  assert.equal(r.payload.routes.length, 1)
})

test("route/list omits `origin` entirely when it isn't — absence is the port-proxy capability probe", () => {
  const r = routeAction("route/list", {}, { routes: new Routes(tmp()), env: {} })
  assert.equal(r.status, 200)
  assert.ok(!("origin" in r.payload))
})

test("add/remove keep their control.js contract through the split", () => {
  const routes = new Routes(tmp())
  const added = routeAction("route/add", { prefix: "/a", port: 3000, label: "A" }, { routes, env: {} })
  assert.equal(added.status, 200)
  assert.equal(added.payload.routes[0].prefix, "/a")
  assert.equal(routeAction("route/add", { prefix: "/a" }, { routes, env: {} }).status, 400)
  assert.equal(routeAction("route/remove", { prefix: "/nope" }, { routes, env: {} }).status, 404)
  const removed = routeAction("route/remove", { prefix: "/a" }, { routes, env: {} })
  assert.equal(removed.status, 200)
  assert.equal(removed.payload.removed, true)
})

test("missing routes registry is 501; an unknown route action is null (control.js 404s it)", () => {
  assert.equal(routeAction("route/list", {}, { routes: null, env: {} }).status, 501)
  assert.equal(routeAction("route/add", { prefix: "/a", port: 1 }, { routes: null, env: {} }).status, 501)
  assert.equal(routeAction("route/frobnicate", {}, { routes: new Routes(tmp()), env: {} }), null)
})
