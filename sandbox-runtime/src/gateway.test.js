const { test } = require("node:test")
const assert = require("node:assert")
const { renderGateway, escapeHtml } = require("./gateway")

test("escapeHtml escapes all dangerous characters", () => {
  assert.equal(escapeHtml('<script>alert("xss")&\'</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&amp;&#39;&lt;/script&gt;')
})

test("renderGateway returns valid HTML with no routes", async () => {
  const html = await renderGateway({ routes: [], sessionToken: "tok", exposedPort: null })
  assert.match(html, /<!doctype html>/)
  assert.match(html, /Oyren Gateway/)
  assert.match(html, /No routes configured/)
  assert.match(html, /token=tok/)
})

test("renderGateway includes route entries", async () => {
  const routes = [
    { prefix: "/studio", port: 3000, label: "Remotion Studio" },
    { prefix: "/api", port: 3001, label: "API" },
  ]
  const html = await renderGateway({ routes, sessionToken: "s" })
  assert.match(html, /Remotion Studio/)
  assert.match(html, /3000/)
  assert.match(html, /\/studio/)
  assert.match(html, /\/api/)
  assert.match(html, /3001/)
})

test("renderGateway shows default exposed port info", async () => {
  const html = await renderGateway({ routes: [], sessionToken: "", exposedPort: 4000 })
  assert.match(html, /4000/)
  assert.match(html, /Default app port/)
})

test("renderGateway download link omits token param when empty", async () => {
  const html = await renderGateway({ routes: [], sessionToken: "" })
  assert.match(html, /href="\/_oyren\/download"/)
})

test("renderGateway download link includes token when present", async () => {
  const html = await renderGateway({ routes: [], sessionToken: "abc123" })
  assert.match(html, /token=abc123/)
})

test("renderGateway shows reserved endpoints table", async () => {
  const html = await renderGateway()
  assert.match(html, /\/_oyren\/gateway/)
  assert.match(html, /\/_oyren\/download/)
  assert.match(html, /\/_oyren\/logs/)
  assert.match(html, /\/_oyren\/health/)
  assert.match(html, /\/terminal/)
})

test("renderGateway includes a Logs card linking to /_oyren/logs", async () => {
  const html = await renderGateway({ routes: [], sessionToken: "abc123" })
  assert.match(html, /View Logs/)
  assert.match(html, /href="\/_oyren\/logs\?token=abc123"/)
})

test("renderGateway logs link omits token param when empty", async () => {
  const html = await renderGateway({ routes: [], sessionToken: "" })
  assert.match(html, /href="\/_oyren\/logs"/)
})

test("renderGateway includes CLI instructions", async () => {
  const html = await renderGateway()
  assert.match(html, /oyren route add/)
  assert.match(html, /oyren route list/)
  assert.match(html, /oyren route remove/)
  assert.match(html, /\.oyren-routes\.json/)
})
