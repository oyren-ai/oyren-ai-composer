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

test("leaves a folder inside the workdir alone — redirecting again would loop", () => {
  assert.equal(ideFolderRedirect(`/_oyren/ide/${T}/?folder=%2Fworkspace%2Facme`, "/workspace/acme"), null)
  assert.equal(ideFolderRedirect(`/_oyren/ide/${T}/?folder=%2Fworkspace%2Facme%2Fsrc`, "/workspace/acme"), null)
  assert.equal(ideFolderRedirect(`/_oyren/ide/${T}/?payload=x`, "/workspace/acme"), null)
})

// Scoping, not security: the editor's own /vscode-remote-resource and its terminal both reach the
// whole filesystem regardless. This keeps a session ON its project — a stray ?folder= from a
// bookmark or a restored window would otherwise land the user's next save outside the repo.
test("pins a folder outside the workdir back to it", () => {
  const pinned = `folder=%2Fworkspace%2Facme`
  assert.match(ideFolderRedirect(`/_oyren/ide/${T}/?folder=%2Fetc`, "/workspace/acme"), new RegExp(pinned))
  assert.match(ideFolderRedirect(`/_oyren/ide/${T}/?folder=%2F`, "/workspace/acme"), new RegExp(pinned))
  // A sibling that merely shares a prefix is still outside — the "/" in the prefix test is why.
  assert.match(
    ideFolderRedirect(`/_oyren/ide/${T}/?folder=%2Fworkspace%2Facme-other`, "/workspace/acme"),
    new RegExp(pinned),
  )
  // `..` must not walk out; the path is normalised before comparison.
  assert.match(
    ideFolderRedirect(`/_oyren/ide/${T}/?folder=%2Fworkspace%2Facme%2F..%2F..%2Fetc`, "/workspace/acme"),
    new RegExp(pinned),
  )
})

test("an empty window is pinned to the workdir, and ?workspace= is normalised away", () => {
  const out = ideFolderRedirect(`/_oyren/ide/${T}/?ew=true`, "/workspace/acme")
  assert.match(out, /folder=%2Fworkspace%2Facme/)
  assert.doesNotMatch(out, /ew=/)
  assert.doesNotMatch(ideFolderRedirect(`/_oyren/ide/${T}/?workspace=%2Fetc`, "/workspace/acme"), /workspace=/)
})

// /workspace is a symlink to the real directory, so a URL built from either spelling names the same
// place. Rejecting the alias would break bookmarks made before the move.
test("accepts the /workspace alias for the real workspace directory", () => {
  const workdir = "/home/oyren/workspace/acme"
  assert.equal(
    ideFolderRedirect(`/_oyren/ide/${T}/?folder=%2Fworkspace%2Facme%2Fsrc`, workdir, "/home/oyren/workspace"),
    null,
  )
  assert.match(
    ideFolderRedirect(`/_oyren/ide/${T}/?folder=%2Fworkspace%2Fother`, workdir, "/home/oyren/workspace"),
    /folder=%2Fhome%2Foyren%2Fworkspace%2Facme/,
  )
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