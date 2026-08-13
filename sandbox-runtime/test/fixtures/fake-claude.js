#!/usr/bin/env node
// Test stand-in for the extension-bundled claude CLI, speaking just enough of the real stream-json
// contract (verified empirically against the Claude Code extension) for the wrapper/broker suites:
//   - dumps pid/argv/env/cwd/isatty(0,1,2) as JSON to $FAKE_CLAUDE_DUMP (spawn-fidelity assertions)
//   - writes one stderr line at startup (the stderr-separation probe — must never reach stdout)
//   - emits {"type":"system","subtype":"init","session_id"} on stdout at startup
//   - answers an initialize control_request with a control_response (the extension waits on this)
//   - on a {"type":"user"} message: an assistant line now, a result line after $FAKE_TURN_MS
//   - on stdin EOF: writes "$FAKE_CLAUDE_DUMP.flushed" (the transcript-flush stand-in), exits 0
//   - on SIGTERM: writes "$FAKE_CLAUDE_DUMP.killed", exits 143
const fs = require("fs")
const tty = require("tty")

const DUMP = process.env.FAKE_CLAUDE_DUMP
if (!DUMP) process.exit(0) // `node --test` runs every file under test/ — inert without a harness

const SID = process.env.FAKE_SESSION_ID || `fake-${process.pid}`
const TURN_MS = Number(process.env.FAKE_TURN_MS) || 100

fs.writeFileSync(DUMP, JSON.stringify({
  pid: process.pid,
  argv: process.argv,
  cwd: process.cwd(),
  env: process.env,
  tty: [tty.isatty(0), tty.isatty(1), tty.isatty(2)],
}))

const out = (obj) => process.stdout.write(JSON.stringify(obj) + "\n")
process.stderr.write("fake-claude: started\n")
out({ type: "system", subtype: "init", session_id: SID, cwd: process.cwd() })

function handle(line) {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.type === "control_request" && msg.request && msg.request.subtype === "initialize") {
    out({ type: "control_response", response: { subtype: "success", request_id: msg.request_id } })
  } else if (msg.type === "user") {
    out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "working" }] }, session_id: SID })
    setTimeout(() => out({ type: "result", subtype: "success", is_error: false, session_id: SID }), TURN_MS)
  }
}

let lineBuf = ""
process.stdin.on("data", (chunk) => {
  lineBuf += chunk.toString("utf8")
  let nl
  while ((nl = lineBuf.indexOf("\n")) !== -1) {
    const line = lineBuf.slice(0, nl)
    lineBuf = lineBuf.slice(nl + 1)
    if (line.trim()) handle(line)
  }
})
process.stdin.on("end", () => {
  fs.writeFileSync(`${DUMP}.flushed`, SID)
  process.exit(0)
})
process.on("SIGTERM", () => {
  fs.writeFileSync(`${DUMP}.killed`, SID)
  process.exit(143)
})
