// Drives writePastedImage with an in-memory fs and a recording PTY. What is pinned: the bytes land in
// the container-owned temp dir under a name the CLIENT can't influence, the absolute path is typed onto
// the PTY (with a trailing space, no newline), the mime picks the extension, and every bad/oversized
// message is a no-op rather than a throw.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const { writePastedImage, pasteDir, extForMime, MAX_IMAGE_BYTES } = require("./terminalImagePaste")

function fakeFs() {
  const files = new Map()
  const dirs = new Set()
  return {
    files,
    dirs,
    mkdirSync: (d) => dirs.add(d),
    writeFileSync: (p, buf) => files.set(p, buf),
  }
}

function fakeTerm() {
  const term = { writes: [] }
  term.write = (d) => term.writes.push(d)
  return term
}

const fixedDeps = (fs) => ({ fs, dir: "/pastes", now: () => 111, rand: () => 0.42 })

test("writes the decoded bytes to a client-independent path and types it onto the PTY", () => {
  const fs = fakeFs()
  const term = fakeTerm()
  const data = Buffer.from("hello").toString("base64")
  const dest = writePastedImage(term, { type: "image", data, mime: "image/png" }, fixedDeps(fs))

  const expected = path.join("/pastes", "paste-111-420000.png")
  assert.equal(dest, expected)
  assert.ok(fs.dirs.has("/pastes"))
  assert.deepEqual(fs.files.get(expected), Buffer.from("hello"))
  // Typed onto the PTY, trailing space, no newline — the user still reviews before submitting.
  assert.deepEqual(term.writes, [expected + " "])
})

test("mime drives the extension, with png as the fallback", () => {
  assert.equal(extForMime("image/jpeg"), "jpg")
  assert.equal(extForMime("image/webp"), "webp")
  assert.equal(extForMime("image/svg+xml"), "svg")
  assert.equal(extForMime("application/octet-stream"), "png")
  assert.equal(extForMime(undefined), "png")
})

test("a jpeg keeps its extension end to end", () => {
  const fs = fakeFs()
  const term = fakeTerm()
  const data = Buffer.from("j").toString("base64")
  const dest = writePastedImage(term, { data, mime: "image/jpeg" }, fixedDeps(fs))
  assert.ok(dest.endsWith(".jpg"))
})

test("a missing or non-string payload is a no-op, never a throw", () => {
  const fs = fakeFs()
  const term = fakeTerm()
  for (const msg of [null, {}, { data: 123 }, { data: "" }]) {
    assert.equal(writePastedImage(term, msg, fixedDeps(fs)), null)
  }
  assert.equal(fs.files.size, 0)
  assert.deepEqual(term.writes, [])
})

test("an oversized image is refused (nothing written, nothing typed)", () => {
  const fs = fakeFs()
  const term = fakeTerm()
  const data = Buffer.alloc(MAX_IMAGE_BYTES + 1).toString("base64")
  assert.equal(writePastedImage(term, { data, mime: "image/png" }, fixedDeps(fs)), null)
  assert.equal(fs.files.size, 0)
  assert.deepEqual(term.writes, [])
})

test("a write failure degrades to null instead of crashing the socket", () => {
  const fs = fakeFs()
  fs.writeFileSync = () => {
    throw new Error("disk full")
  }
  const term = fakeTerm()
  const data = Buffer.from("hello").toString("base64")
  assert.equal(writePastedImage(term, { data, mime: "image/png" }, fixedDeps(fs)), null)
  assert.deepEqual(term.writes, [])
})

test("the default paste dir sits under the OS temp dir, not a client path", () => {
  assert.ok(pasteDir().endsWith(path.join("oyren-terminal-pastes")))
  assert.ok(path.isAbsolute(pasteDir()))
})
