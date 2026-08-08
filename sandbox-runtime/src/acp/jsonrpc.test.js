const { test } = require("node:test")
const assert = require("node:assert")
const { createRpc } = require("./jsonrpc")
const { makeFakeAcpChild, until } = require("./acpFakes")

test("requests correlate replies by id — even when they arrive out of order", async () => {
  const child = makeFakeAcpChild()
  const rpc = createRpc(child)
  const first = rpc.request("one", {})
  const second = rpc.request("two", {})
  await until(() => child.received.length === 2)
  child.outbound({ jsonrpc: "2.0", id: child.received[1].id, result: { got: "two" } }) // reply to the SECOND first
  child.outbound({ jsonrpc: "2.0", id: child.received[0].id, result: { got: "one" } })
  assert.deepEqual(await first, { got: "one" })
  assert.deepEqual(await second, { got: "two" })
})

test("an error reply rejects with code + data attached", async () => {
  const child = makeFakeAcpChild()
  const rpc = createRpc(child)
  const p = rpc.request("boom", {})
  await until(() => child.received.length === 1)
  child.outbound({ jsonrpc: "2.0", id: child.received[0].id, error: { code: 401, message: "auth required", data: { url: "https://x" } } })
  await assert.rejects(p, (e) => e.code === 401 && e.data.url === "https://x" && /auth required/.test(e.message))
})

test("incoming agent requests are answered through onRequest with the SAME id", async () => {
  const child = makeFakeAcpChild()
  const rpc = createRpc(child)
  rpc.onRequest(async (method, params) => ({ echoed: method, n: params.n }))
  child.outbound({ jsonrpc: "2.0", id: 77, method: "session/request_permission", params: { n: 5 } })
  await until(() => child.received.length === 1)
  assert.deepEqual(child.received[0], { jsonrpc: "2.0", id: 77, result: { echoed: "session/request_permission", n: 5 } })
})

test("a throwing onRequest handler (and a missing one) sends an error response, never silence", async () => {
  const child = makeFakeAcpChild()
  const rpc = createRpc(child)
  child.outbound({ jsonrpc: "2.0", id: 1, method: "fs/read_text_file", params: {} }) // no handler yet
  await until(() => child.received.length === 1)
  assert.equal(child.received[0].error.code, -32601)
  rpc.onRequest(async () => { throw Object.assign(new Error("nope"), { code: -32601 }) })
  child.outbound({ jsonrpc: "2.0", id: 2, method: "terminal/create", params: {} })
  await until(() => child.received.length === 2)
  assert.deepEqual(child.received[1], { jsonrpc: "2.0", id: 2, error: { code: -32601, message: "nope" } })
})

test("notifications dispatch to onNotification; non-JSON stdout lines are logged and skipped", async () => {
  const child = makeFakeAcpChild()
  const logged = []
  const rpc = createRpc(child, { log: (m) => logged.push(m) })
  const seen = []
  rpc.onNotification((method, params) => seen.push([method, params]))
  child.stdout.write("starting agent...\n") // a banner the protocol must survive
  child.notify("session/update", { k: 1 })
  const p = rpc.request("ping", {})
  await until(() => child.received.length === 1)
  child.stdout.write("garbage {not json\n")
  child.outbound({ jsonrpc: "2.0", id: child.received[0].id, result: "pong" })
  assert.equal(await p, "pong") // garbage in between never wedged the reply
  assert.deepEqual(seen, [["session/update", { k: 1 }]])
  assert.equal(logged.length, 2)
})

test("a reply split across stdout chunks still parses (NDJSON reassembly)", async () => {
  const child = makeFakeAcpChild()
  const rpc = createRpc(child)
  const p = rpc.request("ping", {})
  await until(() => child.received.length === 1)
  const line = JSON.stringify({ jsonrpc: "2.0", id: child.received[0].id, result: "whole" }) + "\n"
  child.stdout.write(line.slice(0, 10))
  child.stdout.write(line.slice(10))
  assert.equal(await p, "whole")
})

test("child exit rejects every pending request", async () => {
  const child = makeFakeAcpChild()
  const rpc = createRpc(child)
  const a = rpc.request("one", {})
  const b = rpc.request("two", {})
  await until(() => child.received.length === 2)
  child.emit("exit", 137)
  await assert.rejects(a, /exited \(code 137\)/)
  await assert.rejects(b, (e) => e.exited === true)
})
