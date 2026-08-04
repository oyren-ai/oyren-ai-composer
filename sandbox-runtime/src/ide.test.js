const { test } = require("node:test")
const assert = require("node:assert/strict")
const { ideAuth, ideFolderRedirect } = require("./ide")

const T = "11111111-2222-4333-8444-555555555555"

test("accepts the token segment", () => {
  assert.equal(ideAuth(`/_oyren/ide/${T}/`, T), true)
  assert.equal(ideAuth(`/_oyren/ide/${T}`, T), true)
  // Every asset and the WS live under the same prefix, so deep paths must pass too.
  assert.equal(ideAuth(`/_oyren/ide/${T}/oss-abc123/static/out/vs/loader.js`, T), true)
  assert.equal(ideAuth(`/_oyren/ide/${T}/oss-abc123?reconnectionToken=x`, T), true)
})

test("rejects a wrong or missing token", () => {
  assert.equal(ideAuth("/_oyren/ide/nope/", T), false)
  assert.equal(ideAuth("/_oyren/ide/", T), false)
  assert.equal(ideAuth("/_oyren/ide", T), false)
})

test("fails closed with no session token — an ungated editor is a root shell", () => {
  assert.equal(ideAuth(`/_oyren/ide/${T}/`, ""), false)
  assert.equal(ideAuth("/_oyren/ide/anything/", ""), false)
})

test("a length mismatch does not throw", () => {
  assert.equal(ideAuth("/_oyren/ide/short/", T), false)
  assert.equal(ideAuth(`/_oyren/ide/${T}extra/`, T), false)
})

test("redirects the bare base path to the resolved workdir", () => {
  assert.equal(
    ideFolderRedirect(`/_oyren/ide/${T}/`, "/workspace/acme"),
    `/_oyren/ide/${T}/?folder=%2Fworkspace%2Facme`,
  )
  assert.equal(
    ideFolderRedirect(`/_oyren/ide/${T}`, "/workspace/acme"),
    `/_oyren/ide/${T}/?folder=%2Fworkspace%2Facme`,
  )
})

test("does not redirect once a folder is already chosen — that would loop", () => {
  assert.equal(ideFolderRedirect(`/_oyren/ide/${T}/?folder=%2Fworkspace`, "/workspace/acme"), null)
  assert.equal(ideFolderRedirect(`/_oyren/ide/${T}/?workspace=x`, "/workspace/acme"), null)
  assert.equal(ideFolderRedirect(`/_oyren/ide/${T}/?payload=x`, "/workspace/acme"), null)
})

test("never redirects asset or websocket requests", () => {
  assert.equal(ideFolderRedirect(`/_oyren/ide/${T}/oss-abc/static/x.js`, "/workspace/acme"), null)
  assert.equal(ideFolderRedirect(`/_oyren/ide/${T}/oss-abc?reconnectionToken=y`, "/workspace/acme"), null)
})

test("no workdir means no redirect", () => {
  assert.equal(ideFolderRedirect(`/_oyren/ide/${T}/`, ""), null)
  assert.equal(ideFolderRedirect(`/_oyren/ide/${T}/`, undefined), null)
})

test("preserves unrelated query params while adding folder", () => {
  const out = ideFolderRedirect(`/_oyren/ide/${T}/?a=1`, "/workspace/acme")
  assert.match(out, /a=1/)
  assert.match(out, /folder=%2Fworkspace%2Facme/)
})