// Relay mode: hello (one JSON line: argv/cwd/env/pid) -> ack {ok:true}|{ok:false,error} within
// 1500ms -> framed relay. Any failure BEFORE the broker produced output (an 'o'/'e'/'x' frame)
// degrades to passthrough via onFallback — a broken broker must never leave the Chat panel dead.
// This process NEVER writes to stdout itself: that channel is the child's NDJSON, byte-for-byte.
const net = require("net")
const { TYPES, encodeFrame, createFrameDecoder } = require("./frames")

// Literal duplicate of src/claudeWrapperSocketPath.js's DEFAULT_SOCKET_PATH — this directory is
// installed standalone under /usr/local/lib/oyren-claude-wrapper with no src/ tree. Keep in sync.
const SOCKET_PATH = process.env.OYREN_CLAUDE_WRAPPER_SOCKET || "/tmp/oyren-claude-wrapper.sock"
const ACK_TIMEOUT_MS = 1500

function startRelay(argv, { onFallback }) {
  const socket = net.createConnection(SOCKET_PATH)
  let phase = "awaiting-ack" // -> "relaying" -> "done"
  let sawOutput = false // an 'o'/'e'/'x' frame seen — fallback's point of no return
  const pendingStdin = [] // stdin bytes already consumed, replayable into a fallback child
  let ackBuf = Buffer.alloc(0)
  let stdinListener = null; let fellBack = false

  function fallback(reason) {
    if (fellBack || phase === "done") return
    fellBack = true
    clearTimeout(ackTimer)
    if (stdinListener) process.stdin.removeListener("data", stdinListener)
    process.stdin.pause()
    try { socket.destroy() } catch { /* already gone */ }
    onFallback(reason, pendingStdin)
  }
  const ackTimer = setTimeout(() => fallback("broker did not ack within 1500ms"), ACK_TIMEOUT_MS)
  function exitLikeChild(payload) {
    phase = "done"
    let info = {}
    try { info = JSON.parse(payload.toString("utf8")) } catch { /* treat as codeless */ }
    try { socket.destroy() } catch { /* already gone */ }
    let waiting = 2 // flush both streams first — process.exit() truncates buffered pipe writes
    const finish = () => {
      if (--waiting > 0) return
      if (info.signal) { // mirror a signal death as a signal death, not a made-up code
        process.removeAllListeners("SIGTERM"); process.removeAllListeners("SIGINT")
        try { process.kill(process.pid, info.signal); return } catch { /* unknown signal */ }
      }
      process.exit(info.signal ? 1 : (info.code ?? 0))
    }
    process.stdout.write("", finish)
    process.stderr.write("", finish)
  }

  const decoder = createFrameDecoder((frame) => {
    if (frame.type === TYPES.STDOUT) { sawOutput = true; pendingStdin.length = 0; process.stdout.write(frame.payload) }
    else if (frame.type === TYPES.STDERR) { sawOutput = true; pendingStdin.length = 0; process.stderr.write(frame.payload) }
    else if (frame.type === TYPES.EXIT) { sawOutput = true; exitLikeChild(frame.payload) }
  })

  socket.on("connect", () => {
    socket.write(JSON.stringify({ v: 2, argv, cwd: process.cwd(), env: process.env, pid: process.pid }) + "\n")
  })
  socket.on("data", (chunk) => {
    if (phase !== "awaiting-ack") return decoder.push(chunk)
    ackBuf = Buffer.concat([ackBuf, chunk])
    const nl = ackBuf.indexOf(0x0a)
    if (nl === -1) return
    let ack = null
    try { ack = JSON.parse(ackBuf.subarray(0, nl).toString("utf8")) } catch { /* malformed */ }
    if (!ack || ack.ok !== true) return fallback(`broker refused (${(ack && ack.error) || "malformed ack"})`)
    clearTimeout(ackTimer)
    phase = "relaying"
    stdinListener = (d) => {
      if (!sawOutput) pendingStdin.push(d) // replayable until the broker has proven itself
      try { socket.write(encodeFrame(TYPES.STDIN, d)) } catch { /* 'error'/'close' decide what's next */ }
    }
    process.stdin.on("data", stdinListener)
    if (ackBuf.length > nl + 1) decoder.push(ackBuf.subarray(nl + 1))
  })

  // Broker gone pre-output -> degrade. AFTER output flowed, respawning can't help (the extension
  // consumed bytes a fresh child won't replay) — accepted v1 limit: exit nonzero, let it surface.
  const onGone = (err) => {
    if (phase === "done" || fellBack) return
    if (!sawOutput) return fallback(err ? `broker unreachable (${err.message})` : "broker closed before any output")
    phase = "done"
    process.stderr.write("oyren-claude-wrapper: broker connection lost mid-session\n")
    process.exit(1)
  }
  socket.on("error", onGone)
  socket.on("close", () => onGone(null))

  // Panel close: the extension SIGTERMs us. Tell the broker (it owns the child and will drain the
  // in-flight turn — src/claudeWrapperDrain.js), then get out of the way promptly.
  const onTerm = () => {
    if (phase === "relaying") { try { socket.write(encodeFrame(TYPES.SIGTERM)) } catch { /* gone */ } }
    phase = "done"
    setTimeout(() => process.exit(0), 50) // hard stop even if the FIN never flushes
    try { socket.end(() => process.exit(0)) } catch { process.exit(0) }
  }
  process.on("SIGTERM", onTerm)
  process.on("SIGINT", onTerm)
}

module.exports = { startRelay, SOCKET_PATH, ACK_TIMEOUT_MS }
