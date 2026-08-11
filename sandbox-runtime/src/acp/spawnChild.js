// Spawn + wire one ACP child process, extracted from acpEngine so the engine keeps only session
// state: stderr mirrored to our logs with a rolling tail (codex-acp writes its real failure reason —
// auth / MCP connect / model — there, and the tail is scanned for login URLs on auth failures), the
// NDJSON JSON-RPC transport, session/update notifications handed to the engine's translator, and the
// permission auto-answer (the bypassPermissions analog). Returns { child, rpc, stderrTail }.
const { spawn } = require("child_process")
const { createRpc } = require("./jsonrpc")
const { choosePermissionOutcome } = require("./permissions")
const { handleCursorMethod } = require("./cursorMethods")

const defaultSpawn = (cfg) => spawn(cfg.cmd, cfg.args, { cwd: cfg.cwd, env: cfg.env, stdio: ["pipe", "pipe", "pipe"] })

function spawnAcpChild({ cfg, kind, spawnImpl, onUpdate, onExit }) {
  const child = (spawnImpl || defaultSpawn)(cfg)
  let stderrTail = ""
  if (child.stderr) child.stderr.on("data", (d) => { const s = d.toString("utf8"); stderrTail = (stderrTail + s).slice(-4096); console.error(`[acp:${kind}] stderr: ${s.trimEnd()}`) })
  child.on("exit", () => onExit(child)) // pending rpc calls reject via jsonrpc's own exit hook
  const rpc = createRpc(child, { log: (m) => console.error(`[acp:${kind}] ${m}`) })
  rpc.onNotification((method, params) => { if (method === "session/update" && params) onUpdate(params.update) })
  rpc.onRequest(async (method, params) => {
    if (method === "session/request_permission") return choosePermissionOutcome(params) // bypassPermissions analog
    // Cursor ACP extension methods (ask_question / create_plan) block the turn until answered —
    // auto-resolve them so the HTTP agent app never hangs waiting for a human.
    const cursor = handleCursorMethod(method, params)
    if (cursor) return cursor
    throw Object.assign(new Error(`client method not supported: ${method}`), { code: -32601 }) // no fs/terminal caps advertised
  })
  return { child, rpc, stderrTail: () => stderrTail }
}

module.exports = { spawnAcpChild }
