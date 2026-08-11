// The broker's side of the wrapper<->broker channel: a unix domain socket server backed by a
// claudeWrapperRegistry. Unix-only, chmod 0700 — never network-exposed, this-machine-only. Per
// connection: read one newline-terminated JSON handshake line naming the session key (falling back
// to a well-known default if the wrapper couldn't derive one — see claude-process-wrapper.js), attach
// to the registry under that key, replay the buffered tail, then relay bytes opaquely both ways until
// the socket closes. Everything after the handshake line is untouched — this module never parses
// claude's own stream-json/ACP protocol, only the one control line that routes the connection.
const net = require("net")
const fs = require("fs")

const NEWLINE = 0x0a

/** Split `buffer` at its first newline into {sessionKey, rest}, or null if no newline has arrived
 *  yet. A missing/malformed handshake line still returns a result — sessionKey null, meaning "use the
 *  caller's fallback" — rather than rejecting the connection outright. */
function parseHandshake(buffer, fallbackSessionKey) {
  const nl = buffer.indexOf(NEWLINE)
  if (nl === -1) return null
  const line = buffer.subarray(0, nl).toString("utf8")
  const rest = buffer.subarray(nl + 1)
  let sessionKey = fallbackSessionKey
  try {
    const parsed = JSON.parse(line)
    if (typeof parsed.sessionKey === "string" && parsed.sessionKey) sessionKey = parsed.sessionKey
  } catch { /* malformed handshake — fall back rather than drop the connection */ }
  return { sessionKey, rest }
}

/** Start the broker's socket server. `registry` is a claudeWrapperRegistry instance. Returns the
 *  net.Server (call .close() to stop listening; it does not touch already-attached engines). */
function startSocketServer(socketPath, registry, { fallbackSessionKey = "default" } = {}) {
  try { fs.unlinkSync(socketPath) } catch { /* fresh boot — nothing stale to remove */ }

  const server = net.createServer((socket) => {
    let pending = Buffer.alloc(0)
    let sessionKey = null
    let attached = false

    const connHandle = {
      onData: (data) => { try { socket.write(data) } catch { /* socket already gone */ } },
      onEngineExit: () => { try { socket.end() } catch { /* already closing */ } },
    }

    function tryHandshake() {
      const parsed = parseHandshake(pending, fallbackSessionKey)
      if (!parsed) return // no newline yet — wait for more bytes
      pending = Buffer.alloc(0)
      sessionKey = parsed.sessionKey
      let attachment
      try {
        attachment = registry.attach(sessionKey, connHandle)
      } catch (e) {
        try { socket.end(JSON.stringify({ error: e.message }) + "\n") } catch { /* already gone */ }
        return
      }
      attached = true
      for (const chunk of attachment.replay) connHandle.onData(chunk)
      if (parsed.rest.length) registry.write(sessionKey, connHandle, parsed.rest)
    }

    socket.on("data", (data) => {
      if (!attached) {
        pending = Buffer.concat([pending, data])
        tryHandshake()
        return
      }
      registry.write(sessionKey, connHandle, data)
    })
    socket.on("close", () => { if (attached) registry.detach(sessionKey, connHandle) })
    // A reset/abort emits 'error'; with no listener net rethrows and crashes the whole broker process
    // (taking every OTHER wrapped session down with it) — handle it so one bad socket only drops itself.
    socket.on("error", () => { try { socket.destroy() } catch { /* already gone */ } })
  })

  server.listen(socketPath, () => {
    try { fs.chmodSync(socketPath, 0o700) } catch { /* best-effort; listen() already succeeded */ }
  })
  return server
}

module.exports = { startSocketServer, parseHandshake }
