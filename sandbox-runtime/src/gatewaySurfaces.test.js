// The Codespace face of the gateway page: the copy, the surfaces card and the reserved-endpoints
// table. Split from gateway.test.js (which pins the routes/downloads/logs contract) to keep both
// under the 100-line rule. The port probe is injected: on a dev machine anything may be listening.
const { test } = require("node:test")
const assert = require("node:assert")
const { renderGateway } = require("./gateway")

const down = async () => false

test("the page speaks Codespace, never container", async () => {
  const html = await renderGateway({ routes: [], sessionToken: "abc123", exposedPort: 4000, probe: down })
  assert.match(html, /This Codespace is running/)
  assert.match(html, /after the Codespace is relaunched/)
  assert.doesNotMatch(html, /container/i)
})

test("the surfaces card lists VS Code, Zed, Browser and Terminal with the token in each gated path", async () => {
  const html = await renderGateway({ routes: [], sessionToken: "abc123", probe: down })
  assert.match(html, /This Codespace's surfaces/)
  assert.match(html, /href="\/_oyren\/ide\/abc123\/"/)
  assert.match(html, /href="\/_oyren\/zed\/abc123\/"/)
  assert.match(html, /href="\/_oyren\/browser\/abc123\/"/)
  assert.match(html, /Terminal/)
  assert.match(html, /<code>\/terminal<\/code>/)
  assert.doesNotMatch(html, /href="\/terminal/) // a WebSocket endpoint — nothing to open in a tab
  // The surfaces come before the routes: they exist whether or not a route was ever configured.
  assert.ok(html.indexOf("This Codespace's surfaces") < html.indexOf("Configured Routes"))
})

test("surfaces degrade to the bare prefix when rendered tokenless, like the download/logs links", async () => {
  const html = await renderGateway({ routes: [], sessionToken: "", probe: down })
  assert.match(html, /href="\/_oyren\/ide\/"/)
  assert.match(html, /href="\/_oyren\/zed\/"/)
  assert.match(html, /href="\/_oyren\/browser\/"/)
  assert.doesNotMatch(html, /token=/)
})

test("Zed and Browser read 'not running' when nothing answers on their ports", async () => {
  const html = await renderGateway({ routes: [], sessionToken: "t", probe: down })
  const row = (name) => html.slice(html.indexOf(`>${name}</a>`), html.indexOf("</tr>", html.indexOf(`>${name}</a>`)))
  assert.match(row("Zed"), /not running/)
  assert.match(row("Browser"), /not running/)
  assert.doesNotMatch(row("Zed"), /● running/)
})

test("a surface whose port answers reads 'running' — the probe decides, per port", async () => {
  const html = await renderGateway({ routes: [], sessionToken: "t", probe: async (port) => port === 6090 })
  const row = (name) => html.slice(html.indexOf(`>${name}</a>`), html.indexOf("</tr>", html.indexOf(`>${name}</a>`)))
  assert.match(row("Zed"), /● running/)
  assert.match(row("Browser"), /not running/)
})

test("the reserved-endpoints table covers every kind routeFor.js knows", async () => {
  const html = await renderGateway({ probe: down })
  for (const p of ["/_oyren/ide", "/_oyren/zed", "/_oyren/zed-clipboard", "/_oyren/browser", "/_oyren/port",
    "/_oyren/runs", "/_oyren/runs.html", "/agent/stream", "/agent/interrupt", "/agent/models", "/agent/current", "/agent/model"]) {
    assert.match(html, new RegExp(`<code>${p.replace(/[./]/g, "\\$&")}`), p)
  }
})
