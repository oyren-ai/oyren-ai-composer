const { test } = require("node:test")
const assert = require("node:assert")
const { EventEmitter } = require("node:events")
const { handleZedClipboard, injectClipboard, tokenFromUrl, wantsAutopaste, mimeOf } = require("./zedClipboard")

test("tokenFromUrl reads path segment 3 and decodes it", () => {
  assert.equal(tokenFromUrl("/_oyren/zed-clipboard/abc123"), "abc123")
  assert.equal(tokenFromUrl("/_oyren/zed-clipboard/abc123?autopaste=0"), "abc123")
  assert.equal(tokenFromUrl("/_oyren/zed-clipboard/a%20b"), "a b")
  assert.equal(tokenFromUrl("/_oyren/zed-clipboard"), "") // no token segment → "" (auth rejects)
})

test("wantsAutopaste defaults on, off only for autopaste=0", () => {
  assert.equal(wantsAutopaste("/_oyren/zed-clipboard/t"), true)
  assert.equal(wantsAutopaste("/_oyren/zed-clipboard/t?autopaste=1"), true)
  assert.equal(wantsAutopaste("/_oyren/zed-clipboard/t?autopaste=0"), false)
})

test("mimeOf strips params and lowercases", () => {
  assert.equal(mimeOf({ headers: { "content-type": "image/PNG; charset=x" } }), "image/png")
  assert.equal(mimeOf({ headers: {} }), "")
})

test("injectClipboard sets the clipboard then pastes when autopaste is on", () => {
  const calls = []
  const runner = (cmd, args, input, done) => { calls.push({ cmd, args, hasInput: !!input }); done(null) }
  let out
  injectClipboard(Buffer.from("x"), "image/png", { autopaste: true, runner }, (e) => { out = e })
  assert.equal(out, null)
  assert.deepEqual(calls.map((c) => c.cmd), ["xclip", "xdotool"])
  assert.deepEqual(calls[0].args, ["-selection", "clipboard", "-t", "image/png"])
  assert.equal(calls[0].hasInput, true)
  assert.deepEqual(calls[1].args, ["key", "--clearmodifiers", "ctrl+v"])
})

test("injectClipboard skips the paste when autopaste is off", () => {
  const cmds = []
  const runner = (cmd, _a, _i, done) => { cmds.push(cmd); done(null) }
  injectClipboard(Buffer.from("x"), "image/png", { autopaste: false, runner }, () => {})
  assert.deepEqual(cmds, ["xclip"])
})

test("injectClipboard fails the request when xclip fails, but swallows a paste failure", () => {
  const xclipErr = new Error("no display")
  let a
  injectClipboard(Buffer.from("x"), "image/png", { autopaste: true, runner: (_c, _a2, _i, done) => done(xclipErr) }, (e) => { a = e })
  assert.equal(a, xclipErr) // clipboard could not be set → surfaced

  let b = "unset"
  const runner = (cmd, _a2, _i, done) => done(cmd === "xdotool" ? new Error("paste boom") : null)
  injectClipboard(Buffer.from("x"), "image/png", { autopaste: true, runner }, (e) => { b = e })
  assert.equal(b, null) // clipboard was set; paste failure must not fail the request
})

// --- handler-level: mock req/res ---
function mockReq({ method = "POST", url, headers = { "content-type": "image/png" } } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = headers
  req.destroy = () => {}
  return req
}
function mockRes() {
  return { code: 0, body: "", writeHead(c) { this.code = c }, end(b) { this.body = b || "" } }
}

test("handler rejects non-POST", () => {
  const res = mockRes()
  handleZedClipboard(mockReq({ method: "GET", url: "/_oyren/zed-clipboard/tok" }), res, { sessionToken: "tok" })
  assert.equal(res.code, 405)
})

test("handler 401s on a bad token", () => {
  const res = mockRes()
  handleZedClipboard(mockReq({ url: "/_oyren/zed-clipboard/wrong" }), res, { sessionToken: "tok" })
  assert.equal(res.code, 401)
})

test("handler 415s on a non-image content-type", () => {
  const res = mockRes()
  const req = mockReq({ url: "/_oyren/zed-clipboard/tok", headers: { "content-type": "text/plain" } })
  handleZedClipboard(req, res, { sessionToken: "tok" })
  assert.equal(res.code, 415)
})

test("handler injects the body and 200s on a valid POST", () => {
  const res = mockRes()
  const seen = []
  const runner = (cmd, _a, input, done) => { seen.push({ cmd, len: input ? input.length : 0 }); done(null) }
  const req = mockReq({ url: "/_oyren/zed-clipboard/tok?autopaste=0" })
  handleZedClipboard(req, res, { sessionToken: "tok", runner })
  req.emit("data", Buffer.from("PNGDATA"))
  req.emit("end")
  assert.equal(res.code, 200)
  assert.deepEqual(JSON.parse(res.body), { ok: true, bytes: 7 })
  assert.deepEqual(seen, [{ cmd: "xclip", len: 7 }]) // autopaste=0 → no xdotool
})

test("handler 400s on an empty body", () => {
  const res = mockRes()
  const req = mockReq({ url: "/_oyren/zed-clipboard/tok" })
  handleZedClipboard(req, res, { sessionToken: "tok", runner: (_c, _a, _i, done) => done(null) })
  req.emit("end")
  assert.equal(res.code, 400)
})
