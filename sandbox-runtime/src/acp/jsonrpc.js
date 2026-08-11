// NDJSON JSON-RPC 2.0 over a child process's stdio — the wire the ACP engine (acpEngine.js) speaks to
// an `--experimental-acp`-style agent CLI. Outgoing requests correlate replies by id; incoming requests
// (agent → client, e.g. session/request_permission) are answered through onRequest; session/update and
// other notifications flow through onNotification. Non-JSON stdout lines (banners, stray logs) are
// logged and skipped so a chatty CLI can never wedge the protocol. Child exit rejects every pending
// request so a crashed agent surfaces as an error result instead of a hang.
function createRpc(child, { log = () => {} } = {}) {
  let nextId = 1
  const pending = new Map() // id → { resolve, reject }
  let requestHandler = null // async (method, params) → result; throw { code, message } to send an error
  let notificationHandler = null // (method, params) → void
  let buffer = ""

  function writeLine(obj) {
    try { child.stdin.write(JSON.stringify(obj) + "\n") } catch (e) { log(`stdin write failed: ${String(e && e.message || e)}`) }
  }

  // timeoutMs>0 bounds the wait: a live-but-silent agent (e.g. codex-acp stalling on an unreachable MCP
  // server during session/new) otherwise leaves the promise pending forever. On timeout we drop the pending
  // entry and reject so the caller surfaces a visible error instead of hanging.
  function request(method, params, timeoutMs) {
    const id = nextId++
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => { if (pending.delete(id)) reject(Object.assign(new Error(`rpc timeout after ${timeoutMs}ms: ${method}`), { code: -32001, timedOut: true })) }, timeoutMs)
        : null
      if (timer && timer.unref) timer.unref()
      const done = (fn) => (arg) => { if (timer) clearTimeout(timer); fn(arg) }
      pending.set(id, { resolve: done(resolve), reject: done(reject) })
      writeLine({ jsonrpc: "2.0", id, method, params })
    })
  }

  const notify = (method, params) => writeLine({ jsonrpc: "2.0", method, params })

  // Agent → client request: answer it (with the SAME id) even when it fails, else the agent hangs.
  async function dispatchRequest(msg) {
    try {
      if (!requestHandler) throw Object.assign(new Error(`no handler for ${msg.method}`), { code: -32601 })
      const result = await requestHandler(msg.method, msg.params)
      writeLine({ jsonrpc: "2.0", id: msg.id, result })
    } catch (e) {
      writeLine({ jsonrpc: "2.0", id: msg.id, error: { code: (e && e.code) || -32603, message: String(e && e.message || e) } })
    }
  }

  function onLine(line) {
    if (!line.trim()) return
    let msg
    try { msg = JSON.parse(line) } catch { return log(`skipping non-JSON stdout line: ${line.slice(0, 200)}`) }
    if (msg && msg.method && msg.id !== undefined) return void dispatchRequest(msg)
    if (msg && msg.method) return void (notificationHandler && notificationHandler(msg.method, msg.params))
    if (msg && msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message || "rpc error"), { code: msg.error.code, data: msg.error.data }))
      else p.resolve(msg.result)
    }
  }

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8")
    let nl
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      onLine(line)
    }
  })

  child.on("exit", (code) => {
    for (const [, p] of pending) p.reject(Object.assign(new Error(`agent process exited (code ${code})`), { exited: true }))
    pending.clear()
  })

  return { request, notify, onRequest: (h) => { requestHandler = h }, onNotification: (h) => { notificationHandler = h } }
}

module.exports = { createRpc }
