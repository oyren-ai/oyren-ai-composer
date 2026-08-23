// The token-gated PTY-over-WebSocket terminal (carried over from repo-terminal). By default the shell
// runs inside tmux ("main") so closing the tab only detaches — the session and any running process
// keep going and a later connection re-attaches. A client may ask for a plain login shell instead
// (`/terminal?tmux=off`, parsed in upgrade.js; the spawn choice lives in terminalSpawn.js).
// server.js does the SESSION_TOKEN check before upgrading.
const { spawnTerminal } = require("./terminalSpawn")
const { writePastedImage } = require("./terminalImagePaste")

/**
 * Build a noServer WebSocketServer wired to spawn a PTY per connection, with keepalive. The two
 * dependencies that cannot load in a unit test — `ws` and node-pty's native build — are looked up
 * only when the caller does not inject its own, so terminal.test.js can drive the real handler.
 */
function setupTerminal(workdir, { spawn, WebSocketServer, env = process.env } = {}) {
  const Wss = WebSocketServer || require("ws").WebSocketServer
  const spawnPty = spawn || require("node-pty").spawn
  const wss = new Wss({ noServer: true })

  wss.on("connection", (ws, _req, { shell = "tmux" } = {}) => {
    const term = spawnTerminal(spawnPty, { shell, workdir, env })
    term.onData((data) => { try { ws.send(data) } catch {} })
    term.onExit(() => { try { ws.close() } catch {} })
    ws.on("message", (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }
      // Guard writes: if the PTY already exited, writing/resizing throws — drop the one socket, never
      // let it bubble into an uncaught exception that would crash the whole sandbox process.
      try {
        if (msg.type === "input") term.write(msg.data)
        else if (msg.type === "resize") term.resize(Number(msg.cols) || 80, Number(msg.rows) || 24)
        // A pasted image: write it to a container file and type its path onto the PTY (terminalImagePaste).
        else if (msg.type === "image") writePastedImage(term, msg)
      } catch {}
    })
    // A socket-level error (reset/abort) emits 'error'; with no listener `ws` rethrows and crashes the
    // process — taking down every other terminal AND the /_oyren/health route, which makes DO recycle
    // the container and wipe /workspace. Handle it so a broken socket only tears down itself.
    ws.on("error", (e) => { console.error("[terminal] socket error:", (e && e.message) || e); try { ws.terminate() } catch {} })
    // Detach the tmux client (the session survives); for a plain shell this is the end of the shell.
    ws.on("close", () => { try { term.kill() } catch {} })
    ws.isAlive = true
    ws.on("pong", () => { ws.isAlive = true })
  })

  // Keepalive ping/pong — survive App Platform's proxy idle timeout; reap dead sockets. Under tmux the
  // reap is non-destructive: the client self-reconnects + re-attaches the same session. For a plain
  // shell (tmux=off) the reap ends that shell — by design: no persistence is the trade-off the client
  // chose when it asked for tmux=off.
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) { console.warn("[terminal] reaping unresponsive socket"); return ws.terminate() }
      ws.isAlive = false
      try { ws.ping() } catch {}
    })
  }, 20_000)
  wss.on("close", () => clearInterval(interval))
  return wss
}

module.exports = { setupTerminal }
