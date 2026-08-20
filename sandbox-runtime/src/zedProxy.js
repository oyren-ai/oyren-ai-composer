// Session-token-gated proxy to the streamed-Zed KasmVNC listener.
//
//   <session-origin>/_oyren/zed/<SESSION_TOKEN>/<rest>?<query>  →  127.0.0.1:6090
//
// The contract (prefix stripping, the ?path= websocket injection, the token gate, the 503 while
// the stack boots) now lives in vncProxy.js, because /_oyren/browser needs exactly the same thing
// against a different port. This file is the Zed INSTANCE of it, and keeps the names the router,
// upgrade handler and tests already import.
const { createVncProxy } = require("./vncProxy")

const ZED_PREFIX = "/_oyren/zed"
// The oyren-zed unit's KasmVNC websocket listener (composer deploy/zed/start-zed.mjs).
const ZED_PORT = Number(process.env.OYREN_ZED_PORT || 6090)

const zed = createVncProxy({ prefix: ZED_PREFIX, port: ZED_PORT, starting: "zed stream starting…" })

const parseZedPath = (rawUrl) => zed.parsePath(rawUrl)
const handleZedProxy = (req, res, { sessionToken, zedPort = ZED_PORT }) =>
  zed.handle(req, res, { sessionToken, vncPort: zedPort })
const handleZedProxyUpgrade = (req, socket, head, { sessionToken, zedPort = ZED_PORT }) =>
  zed.handleUpgrade(req, socket, head, { sessionToken, vncPort: zedPort })

module.exports = { ZED_PREFIX, ZED_PORT, parseZedPath, handleZedProxy, handleZedProxyUpgrade }
