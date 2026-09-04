// serveStatic's containment guard: nothing outside the static root is ever served, and the assets
// that legitimately live under it still are. Uses a real temp root with a file planted OUTSIDE it,
// so an escape would be visible as content rather than inferred from a path string.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { serveStatic } = require("./staticSite")

/** A static root holding index.html + main.js, with SECRET planted in its PARENT directory. */
function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-static-"))
  const root = path.join(base, "web")
  fs.mkdirSync(root)
  fs.writeFileSync(path.join(root, "index.html"), "<h1>index</h1>")
  fs.writeFileSync(path.join(root, "main.js"), "console.log(1)")
  fs.writeFileSync(path.join(base, "secret.txt"), "TOP SECRET")
  return { base, root }
}

/** Drive serveStatic and resolve what it wrote: { status, type, body }. */
function serve(root, reqPath) {
  return new Promise((resolve) => {
    const res = {
      writeHead(status, headers) { this.status = status; this.type = (headers || {})["content-type"] },
      end(body) { resolve({ status: this.status, type: this.type, body: String(body) }) },
    }
    serveStatic(res, root, reqPath)
  })
}

test("serves the assets that really live under the static root", async () => {
  const { root } = fixture()
  const asset = await serve(root, "/how-to-deploy/main.js")
  assert.equal(asset.status, 200)
  assert.match(asset.type, /javascript/)
  assert.equal(asset.body, "console.log(1)")
  for (const p of ["/how-to-deploy", "/how-to-deploy/", "/how-to-deploy/index.html"]) {
    const index = await serve(root, p)
    assert.equal(index.status, 200, p)
    assert.match(index.body, /<h1>index<\/h1>/, p)
  }
})

test("a doubled slash still resolves the asset (the containment fix must not 404 it)", async () => {
  const { root } = fixture()
  const got = await serve(root, "/how-to-deploy//main.js")
  assert.equal(got.status, 200)
  assert.equal(got.body, "console.log(1)")
})

test("nothing outside the static root is served — the escape attempt falls back to the 404 index", async () => {
  const { root } = fixture()
  const attempts = [
    "/how-to-deploy/../secret.txt",
    "/how-to-deploy/....//secret.txt",
    "/how-to-deploy/../../../../etc/passwd",
    "/how-to-deploy/..\\secret.txt",
    "/how-to-deploy//../secret.txt",
    "/how-to-deploy/subdir/../../secret.txt",
  ]
  for (const attempt of attempts) {
    const got = await serve(root, attempt)
    assert.equal(got.status, 404, attempt)
    assert.ok(!got.body.includes("TOP SECRET"), `leaked outside the root via ${attempt}`)
  }
})

test("an absolute path in the request cannot escape the root either", async () => {
  const { base, root } = fixture()
  const got = await serve(root, `/how-to-deploy/${path.join(base, "secret.txt")}`)
  assert.equal(got.status, 404)
  assert.ok(!got.body.includes("TOP SECRET"))
})
