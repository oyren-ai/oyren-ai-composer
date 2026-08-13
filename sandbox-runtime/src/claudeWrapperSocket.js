// The broker's unix socket server (protocol v2). Per connection: one newline-terminated JSON hello
// (argv/cwd/env/pid), one JSON ack line ({ok:true} | {ok:false,error}), then binary frames both
// ways — 'i' stdin and 's' SIGTERM-notice from the wrapper; 'o' stdout, 'e' stderr and 'x' exit
// going back (see claude-wrapper/frames.js). Unix-only, chmod 0700 — this-machine-only, never
// network-exposed.
const net = require("net")
const fs = require("fs")
const { parseHello } = require("./claudeWrapperHello")
const { TYPES, encodeFrame, createFrameDecoder } = require("./claudeWrapperFrames")

/** Start the broker's socket server over `registry` (claudeWrapperRegistry). Returns the
 *  net.Server — .close() stops listening without touching live or draining children. */
function startSocketServer(socketPath, registry) {
  try { fs.unlinkSync(socketPath) } catch { /* fresh boot — nothing stale to remove */ }

  const server = net.createServer((socket) => {
    let pending = Buffer.alloc(0) // pre-hello bytes; null once the hello line is consumed
    let session = null
    let gone = false

    const send = (buf) => { if (!socket.destroyed) { try { socket.write(buf) } catch { /* racing close */ } } }
    const decoder = createFrameDecoder((frame) => {
      if (!session) return // no frames are ever sent pre-ack; anything here is a broken client
      if (frame.type === TYPES.STDIN) session.write(frame.payload)
      else if (frame.type === TYPES.SIGTERM) disconnect() // panel close notice — start the drain
    })

    function disconnect() {
      if (gone) return
      gone = true
      if (session) session.disconnect()
      try { socket.end() } catch { /* already gone */ }
    }

    async function onHello() {
      const parsed = parseHello(pending)
      if (!parsed) return // no newline yet — wait for more bytes
      pending = null // hello consumed — every later byte is frames
      if (parsed.error) {
        try { socket.end(JSON.stringify({ ok: false, error: parsed.error }) + "\n") } catch { /* gone */ }
        return
      }
      const res = await registry.claim(parsed.hello) // may hold briefly (resume-race) — see registry
      if (!res.ok) {
        try { socket.end(JSON.stringify(res) + "\n") } catch { /* gone */ }
        return
      }
      session = res.session
      if (gone) { session.disconnect(); return } // the socket died while we were claiming
      session.attachSink({
        stdout: (buf) => send(encodeFrame(TYPES.STDOUT, buf)),
        stderr: (buf) => send(encodeFrame(TYPES.STDERR, buf)),
        exit: (info) => { // the child finished while connected — report in-band, then hang up
          session.release()
          gone = true
          send(encodeFrame(TYPES.EXIT, Buffer.from(JSON.stringify({ code: info.code ?? null, signal: info.signal ?? null }))))
          try { socket.end() } catch { /* already gone */ }
        },
      })
      send(Buffer.from(JSON.stringify({ ok: true }) + "\n"))
      if (parsed.rest.length) decoder.push(parsed.rest)
    }

    socket.on("data", (chunk) => {
      if (pending !== null) {
        pending = Buffer.concat([pending, chunk])
        onHello().catch(() => { try { socket.destroy() } catch { /* already gone */ } })
        return
      }
      decoder.push(chunk)
    })
    socket.on("close", disconnect)
    // A reset/abort emits 'error'; with no listener net rethrows and crashes the whole broker
    // process (taking every OTHER wrapped session's drain down with it) — handle it so one bad
    // socket only drops itself.
    socket.on("error", () => { try { socket.destroy() } catch { /* already gone */ } })
  })

  server.listen(socketPath, () => {
    try { fs.chmodSync(socketPath, 0o700) } catch { /* best-effort; listen() already succeeded */ }
  })
  return server
}

module.exports = { startSocketServer }
