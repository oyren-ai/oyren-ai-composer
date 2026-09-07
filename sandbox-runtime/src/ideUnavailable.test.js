const { test } = require("node:test")
const assert = require("node:assert")
const { serveIdeUnavailable, RETRY_SECONDS } = require("./ideUnavailable")

function mockRes() {
  return {
    headersSent: false,
    statusCode: null,
    headers: null,
    body: "",
    ended: false,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers },
    end(chunk) { if (chunk) this.body += chunk; this.ended = true },
  }
}

test("serves a 503 self-refreshing HTML page", () => {
  const res = mockRes()
  serveIdeUnavailable(res)
  assert.equal(res.statusCode, 503)
  assert.equal(res.headers["content-type"], "text/html; charset=utf-8")
  // no-store: the browser must never cache the outage page for the IDE URL
  assert.equal(res.headers["cache-control"], "no-store")
  assert.equal(res.headers["retry-after"], String(RETRY_SECONDS))
  assert.match(res.body, /<!doctype html>/)
  assert.match(res.body, new RegExp(`http-equiv="refresh" content="${RETRY_SECONDS}"`))
  assert.match(res.body, /Editor is restarting/)
  assert.ok(res.ended)
})

test("mid-stream failure (headers already sent) just closes the response", () => {
  const res = mockRes()
  res.headersSent = true
  serveIdeUnavailable(res)
  assert.equal(res.statusCode, null) // no second writeHead — that would throw on a real res
  assert.equal(res.body, "")
  assert.ok(res.ended)
})
