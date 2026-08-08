// config.js reads SESSION_TOKEN once at require time, so set it before requiring download.js.
process.env.SESSION_TOKEN = "sekret"

const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { Writable } = require("stream")
const { handleDownload, listDeliverables, stagingDir } = require("./download")

function tmpWorkdir() {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), "oyren-dl-"))
  fs.mkdirSync(stagingDir(wd))
  return wd
}

function mockRes() {
  const chunks = []
  let status = null, headers = null
  const res = new Writable({ write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb() } })
  res.writeHead = (code, h) => { status = code; headers = h || {}; return res }
  const finished = new Promise((r) => res.on("finish", r))
  return { res, finished, get status() { return status }, get headers() { return headers }, body: () => Buffer.concat(chunks).toString("utf8") }
}

test("rejects a request with a wrong token (401)", async () => {
  const m = mockRes()
  handleDownload({ url: "/_oyren/download?token=nope" }, m.res, { workdir: tmpWorkdir() })
  await m.finished
  assert.equal(m.status, 401)
})

test("returns an HTML index of staged files for a valid token", async () => {
  const wd = tmpWorkdir()
  fs.writeFileSync(path.join(stagingDir(wd), "video.mp4"), "xx")
  const m = mockRes()
  handleDownload({ url: "/_oyren/download?token=sekret" }, m.res, { workdir: wd })
  await m.finished
  assert.equal(m.status, 200)
  assert.match(m.headers["content-type"], /text\/html/)
  assert.match(m.body(), /video\.mp4/)
})

test("streams a staged file as an attachment", async () => {
  const wd = tmpWorkdir()
  fs.writeFileSync(path.join(stagingDir(wd), "video.mp4"), "MP4BYTES")
  const m = mockRes()
  handleDownload({ url: "/_oyren/download?token=sekret&file=video.mp4" }, m.res, { workdir: wd })
  await m.finished
  assert.equal(m.status, 200)
  assert.match(m.headers["content-disposition"], /attachment; filename="video\.mp4"/)
  assert.equal(m.body(), "MP4BYTES")
})

test("a traversal file param cannot escape the staging dir (404)", async () => {
  const wd = tmpWorkdir()
  fs.writeFileSync(path.join(wd, "secret.txt"), "TOP") // sits in workdir, NOT the staging dir
  const m = mockRes()
  handleDownload({ url: "/_oyren/download?token=sekret&file=" + encodeURIComponent("../secret.txt") }, m.res, { workdir: wd })
  await m.finished
  assert.equal(m.status, 404)
})

test("listDeliverables lists files, skips dotfiles and subdirs", () => {
  const d = stagingDir(tmpWorkdir())
  fs.writeFileSync(path.join(d, "a.mp4"), "1")
  fs.writeFileSync(path.join(d, ".hidden"), "1")
  fs.mkdirSync(path.join(d, "sub"))
  assert.deepEqual(listDeliverables(d), ["a.mp4"])
})
