// Session-token-gated proxy to the in-VM browser's KasmVNC listener.
//
//   <session-origin>/_oyren/browser/<SESSION_TOKEN>/<rest>?<query>  →  127.0.0.1:6091
//
// WHY a browser lives on the droplet at all: every OAuth login an agent CLI starts (codex, claude)
// redirects to a LOOPBACK callback — http://localhost:1455/auth/callback and friends. Neither CLI
// lets that callback be overridden (checked: `codex login` has --device-auth but no redirect flag;
// claude's CLAUDE_CODE_CUSTOM_OAUTH_URL is validated against an Anthropic allowlist), and no OAuth
// provider would accept a non-loopback redirect anyway (RFC 8252 §7.3). Put the BROWSER on the same
// machine and the problem dissolves: `localhost` in that browser IS the sandbox, so the callback
// lands on the CLI that started it — and a user's own dev server on localhost:3000 is reachable
// from it too, with no route or port proxy involved.
//
// Same contract as the Zed stream (vncProxy.js owns it), different port.
const { createVncProxy } = require("./vncProxy")

const BROWSER_PREFIX = "/_oyren/browser"
// The oyren-browser unit's KasmVNC websocket listener (composer deploy/browser/start-browser.mjs).
const BROWSER_PORT = Number(process.env.OYREN_BROWSER_PORT || 6091)

const browser = createVncProxy({
  prefix: BROWSER_PREFIX,
  port: BROWSER_PORT,
  // The unit is on-demand: opening the Browser app in the workbench starts it, and so does
  // `oyren-open <url>` from a terminal. Name exactly those two — `bin/oyren` has no `browser`
  // subcommand, and a hint pointing at one sends the user to an error.
  starting: "browser starting — open the Browser app in the workbench, or run `oyren-open <url>` in a terminal",
})

const parseBrowserPath = (rawUrl) => browser.parsePath(rawUrl)
const handleBrowserProxy = (req, res, { sessionToken, browserPort = BROWSER_PORT }) =>
  browser.handle(req, res, { sessionToken, vncPort: browserPort })
const handleBrowserProxyUpgrade = (req, socket, head, { sessionToken, browserPort = BROWSER_PORT }) =>
  browser.handleUpgrade(req, socket, head, { sessionToken, vncPort: browserPort })

module.exports = { BROWSER_PREFIX, BROWSER_PORT, parseBrowserPath, handleBrowserProxy, handleBrowserProxyUpgrade }
