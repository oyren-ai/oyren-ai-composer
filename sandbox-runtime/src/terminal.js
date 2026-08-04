// The token-gated PTY-over-WebSocket terminal (carried over from repo-terminal). The shell runs
// inside tmux ("main") so closing the tab only detaches — the session and any running process keep
// going and a later connection re-attaches. server.js does the SESSION_TOKEN check before upgrading.
const { WebSocketServer } = require("ws")
const pty = require("node-pty")

/** Build a noServer WebSocketServer wired to spawn a tmux PTY per connection, with keepalive. */
function setupTerminal(workdir) {
  const wss = new WebSocketServer({ noServer: true })

  wss.on("connection", (ws) => {
    // `-u` forces tmux UTF-8 mode so multibyte glyphs (Claude Code's ✻/box-drawing/❯) pass through
    // intact — insurance on top of the image's LANG=C.UTF-8 (Dockerfile).
    const term = pty.spawn("tmux", ["-u", "new-session", "-A", "-s", "main"], {
      name: "xterm-256color", cols: 80, rows: 24, cwd: workdir, env: process.env,
    })
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
      } catch {}
    })
    // A socket-level error (reset/abort) emits 'error'; with no listener `ws` rethrows and crashes the
    // process — taking down every other terminal AND the /_oyren/health route, which makes DO recycle
    // the container and wipe /workspace. Handle it so a broken socket only tears down itself.
    ws.on("error", (e) => { console.error("[terminal] socket error:", (e && e.message) || e); try { ws.terminate() } catch {} })
    ws.on("close", () => { try { term.kill() } catch {} }) // detach the tmux client; the session survives
    ws.isAlive = true
    ws.on("pong", () => { ws.isAlive = true })
  })

  // Keepalive ping/pong — survive App Platform's proxy idle timeout; reap dead sockets (the client
  // self-reconnects + re-attaches the same tmux session, so reaping a stale socket is non-destructive).
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
