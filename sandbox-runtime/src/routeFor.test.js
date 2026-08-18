const { test } = require("node:test")
const assert = require("node:assert")
const { routeFor, wsRouteFor } = require("./routeFor")

test("health path is its own kind and ignores query strings", () => {
  assert.equal(routeFor("/_oyren/health").kind, "health")
  assert.equal(routeFor("/_oyren/health?x=1").kind, "health")
  assert.equal(routeFor("/_oyren/zed/tok/vnc.html").kind, "zed")
  assert.equal(routeFor("/_oyren/zedx").kind, "app") // not a prefix match
})

test("control namespace matches the base and sub-paths", () => {
  assert.equal(routeFor("/_oyren/control").kind, "control")
  assert.equal(routeFor("/_oyren/control/expose").kind, "control")
  assert.equal(routeFor("/_oyren/controlxyz").kind, "app") // not a prefix match
})

test("download namespace matches the base and ignores query", () => {
  assert.equal(routeFor("/_oyren/download").kind, "download")
  assert.equal(routeFor("/_oyren/download?token=x&file=v.mp4").kind, "download")
  assert.equal(routeFor("/_oyren/downloadxyz").kind, "app") // not a prefix match
})

test("logs namespace matches the base and sub-paths (including /raw)", () => {
  assert.equal(routeFor("/_oyren/logs").kind, "logs")
  assert.equal(routeFor("/_oyren/logs?token=x").kind, "logs")
  assert.equal(routeFor("/_oyren/logs/raw?token=x").kind, "logs")
  assert.equal(routeFor("/_oyren/logsxyz").kind, "app") // not a prefix match
})

test("runs namespace matches the base and sub-paths, ignores query", () => {
  assert.equal(routeFor("/_oyren/runs").kind, "runs")
  assert.equal(routeFor("/_oyren/runs?token=x").kind, "runs")
  assert.equal(routeFor("/_oyren/runs?token=x&runId=run-1").kind, "runs")
  assert.equal(routeFor("/_oyren/runsxyz").kind, "app") // not a prefix match
})

test("runs.html is the browsable HTML page, distinct from the JSON runs endpoint", () => {
  assert.equal(routeFor("/_oyren/runs.html").kind, "runs-page")
  assert.equal(routeFor("/_oyren/runs.html?token=x").kind, "runs-page")
  assert.equal(routeFor("/_oyren/runs").kind, "runs") // JSON endpoint is untouched
})

test("how-to-deploy is static, with and without trailing path", () => {
  assert.equal(routeFor("/how-to-deploy").kind, "static")
  assert.equal(routeFor("/how-to-deploy/").kind, "static")
  assert.equal(routeFor("/how-to-deploy/main.js").kind, "static")
})

test("agent/message is its own kind, base + sub-paths, ignores query", () => {
  assert.equal(routeFor("/agent/message").kind, "agent")
  assert.equal(routeFor("/agent/message?token=x").kind, "agent")
  assert.equal(routeFor("/agent/messagexyz").kind, "app") // not a prefix match
})

test("gateway namespace matches the base and sub-paths", () => {
  assert.equal(routeFor("/_oyren/gateway").kind, "gateway")
  assert.equal(routeFor("/_oyren/gateway/").kind, "gateway")
  assert.equal(routeFor("/_oyren/gatewayxyz").kind, "app") // not a prefix match
})

test("the interactive agent endpoints each get their own kind", () => {
  assert.equal(routeFor("/agent/stream?token=x").kind, "agent-stream")
  assert.equal(routeFor("/agent/interrupt").kind, "agent-interrupt")
  assert.equal(routeFor("/agent/models?token=x").kind, "agent-models")
  assert.equal(routeFor("/agent/model").kind, "agent-model") // /model is distinct from /models
  assert.equal(routeFor("/agent/current").kind, "agent-current")
})

test("everything else is the user app", () => {
  assert.equal(routeFor("/").kind, "app")
  assert.equal(routeFor("/api/users").kind, "app")
  assert.equal(routeFor("/terminal").kind, "app") // HTTP GET /terminal is not reserved; WS is
})

test("ws upgrades route terminal vs user app", () => {
  assert.equal(wsRouteFor("/terminal?token=x").kind, "terminal")
  assert.equal(wsRouteFor("/terminal/socket").kind, "terminal")
  assert.equal(wsRouteFor("/socket.io/").kind, "app")
})

test("the port proxy gets its own kind in BOTH http and ws dispatch", () => {
  assert.equal(routeFor("/_oyren/port/tok/3000/").kind, "port")
  assert.equal(routeFor("/_oyren/port/tok/3000/assets/app.js?v=1").kind, "port")
  assert.equal(routeFor("/_oyren/port").kind, "port")
  assert.equal(wsRouteFor("/_oyren/port/tok/3000/ws").kind, "port")
  assert.equal(wsRouteFor("/_oyren/zed/tok/websockify").kind, "zed")
})

test("/_oyren/portxyz is not a prefix match — it stays the user app", () => {
  assert.equal(routeFor("/_oyren/portxyz").kind, "app")
  assert.equal(wsRouteFor("/_oyren/portxyz").kind, "app")
})