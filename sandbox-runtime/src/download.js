// GET /_oyren/download?token=<SESSION_TOKEN>[&file=NAME] — hand a staged deliverable (e.g. a rendered MP4)
// straight to the user's browser over the container's public tunnel. The agent stages files under
// /workspace/.oyren-deliver; with no `file` we return a small HTML index of them, and `?file=NAME` streams
// that one as an attachment. Auth reuses the SESSION_TOKEN `?token=` gate (same secret as /agent/message +
// /terminal); exposure is confined to the staging dir, never the whole workspace.
const fs = require("fs")
const path = require("path")
const { SESSION_TOKEN } = require("./config")

const STAGING_SUBDIR = ".oyren-deliver"
const stagingDir = (workdir) => path.join(workdir, STAGING_SUBDIR)

function tokenOk(reqUrl) {
  try {
    return !!SESSION_TOKEN && new URL(reqUrl, "http://localhost").searchParams.get("token") === SESSION_TOKEN
  } catch {
    return false
  }
}

/** Top-level regular files in the staging dir (no dotfiles, no subdirs), sorted. */
function listDeliverables(dir) {
  let names
  try { names = fs.readdirSync(dir) } catch { return [] }
  return names
    .filter((n) => !n.startsWith("."))
    .filter((n) => { try { return fs.statSync(path.join(dir, n)).isFile() } catch { return false } })
    .sort()
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))

function sendIndex(res, token, files) {
  const rows = files.length
    ? files.map((f) => `<li><a href="?token=${encodeURIComponent(token)}&file=${encodeURIComponent(f)}" download>${escapeHtml(f)}</a></li>`).join("")
    : "<li>No deliverables yet — the agent hasn't staged any files.</li>"
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Downloads</title><body style="font-family:system-ui,sans-serif;max-width:640px;margin:3rem auto;padding:0 1rem">` +
    `<h1 style="font-size:1.25rem">Deliverables</h1><ul style="line-height:2">${rows}</ul></body>`
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
  res.end(html)
}

function sendFile(res, dir, name) {
  const safe = path.basename(name) // basename only → no directories, no traversal
  const full = path.join(dir, safe)
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("not found") }
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": st.size,
      "content-disposition": `attachment; filename="${safe.replace(/"/g, "")}"`,
    })
    fs.createReadStream(full).on("error", () => res.destroy()).pipe(res)
  })
}

/** Entry from the HTTP router (route.kind === "download"). */
function handleDownload(req, res, { workdir }) {
  if (!tokenOk(req.url)) {
    res.writeHead(401, { "content-type": "application/json" })
    return res.end(JSON.stringify({ error: "unauthorized" }))
  }
  const url = new URL(req.url, "http://localhost")
  const file = url.searchParams.get("file")
  const dir = stagingDir(workdir)
  if (!file) return sendIndex(res, url.searchParams.get("token") || "", listDeliverables(dir))
  return sendFile(res, dir, file)
}

module.exports = { handleDownload, listDeliverables, stagingDir, tokenOk }
