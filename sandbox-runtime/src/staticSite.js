// Serves the static how-to-deploy site (plain HTML + three.js, no Next.js). `serveStatic` maps
// `/how-to-deploy[/asset]` onto files under web/; `serveIndex` renders index.html as the fallback
// shown at `/` before a port is exposed (and on a 503 when the exposed app isn't answering yet).
const fs = require("fs")
const path = require("path")

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
}

function serveIndex(res, dir, status = 200) {
  fs.readFile(path.join(dir, "index.html"), (err, buf) => {
    if (err) { res.writeHead(500, { "content-type": "text/plain" }); return res.end("how-to-deploy page missing") }
    res.writeHead(status, { "content-type": TYPES[".html"] })
    res.end(buf)
  })
}

function serveStatic(res, dir, reqPath, status = 200) {
  // A leading "/" survives when the path has repeated slashes ("/how-to-deploy//main.js"); strip it
  // so the join stays relative — path.resolve would otherwise treat it as an absolute path and the
  // containment check below would 404 a legitimate asset.
  let rel = reqPath.replace(/^\/how-to-deploy\/?/, "").replace(/^\/+/, "")
  if (rel === "" || rel.endsWith("/")) rel += "index.html"
  // Containment, not pattern-stripping: resolve against the static root and require the result to
  // stay underneath it. The old prefix-strip was a weaker latent guard (fuzzing found no live
  // escape, but it reasoned about the shape of the path instead of where it actually lands).
  const root = path.resolve(dir)
  const full = path.resolve(root, rel)
  if (full !== root && !full.startsWith(root + path.sep)) return serveIndex(res, dir, 404)
  fs.readFile(full, (err, buf) => {
    if (err) return serveIndex(res, dir, 404)
    res.writeHead(status, { "content-type": TYPES[path.extname(full)] || "application/octet-stream" })
    res.end(buf)
  })
}

module.exports = { serveStatic, serveIndex }
