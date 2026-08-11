// Shared fake for the ACP tests (like agentFakes.js for the SDK engine): a scripted child-process
// stand-in with real stdout/stderr streams and a stdin that parses every client → agent line. Pass a
// handleRequest(method, params, io) to script the agent's replies; io.notify / io.request let the
// script push session/update notifications or agent → client requests mid-call. Deliberately NOT a
// *.test.js file so `node --test` never runs it.
const { EventEmitter } = require("node:events")
const { PassThrough } = require("node:stream")

function makeFakeAcpChild(handleRequest) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.killed = false
  child.kill = () => { if (!child.killed) { child.killed = true; child.emit("exit", 0) } }

  const outbound = (obj) => child.stdout.write(JSON.stringify(obj) + "\n")
  const notify = (method, params) => outbound({ jsonrpc: "2.0", method, params })
  let nextId = 1000
  const request = (method, params) => outbound({ jsonrpc: "2.0", id: nextId++, method, params })

  child.received = [] // every parsed client → agent message, in arrival order
  child.stdin = {
    write(data) {
      for (const line of String(data).split("\n")) {
        if (!line.trim()) continue
        const msg = JSON.parse(line)
        child.received.push(msg)
        if (msg.id !== undefined && msg.method && handleRequest) {
          setImmediate(async () => {
            try { outbound({ jsonrpc: "2.0", id: msg.id, result: await handleRequest(msg.method, msg.params, { notify, request }) }) }
            catch (e) { outbound({ jsonrpc: "2.0", id: msg.id, error: { code: e.code || -32603, message: String(e.message || e), data: e.data } }) }
          })
        }
      }
      return true
    },
  }
  return Object.assign(child, { outbound, notify, request })
}

/** Poll until `fn()` is truthy (the async seams here are streams + setImmediate, not timers). */
async function until(fn, ms = 1000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error("until(): condition never became true")
    await new Promise((r) => setImmediate(r))
  }
}

module.exports = { makeFakeAcpChild, until }
