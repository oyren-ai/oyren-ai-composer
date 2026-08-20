// Session-token-gated endpoint that pushes an image into the streamed-Zed session's clipboard.
//
// WHY THIS EXISTS: the Zed stream (ZedStreamView in oyren-ai-next) is a KasmVNC web client in an
// iframe served from the CONTAINER's origin — a different origin than the Oyren app around it. So the
// app can never capture a Ctrl+V that happens over the stream, and KasmVNC's own clipboard bridge is
// text-only in practice. Instead the Oyren UI captures the pasted/dropped image in its OWN chrome and
// POSTs the bytes here; we own the X11 CLIPBOARD selection on the Zed display via xclip, then send
// Ctrl+V with xdotool so it lands in whatever Zed surface has focus (typically the agent panel input).
//
// URL CONTRACT:
//   <session-origin>/_oyren/zed-clipboard/<SESSION_TOKEN>[?autopaste=1]
//   - POST only; the body is the raw image (Content-Type image/png|jpeg|gif|webp). Max 10 MiB.
//   - Token at path segment 3, constant-time compared exactly like the zed proxy (fails closed 401).
//   - Default sets Zed's clipboard ONLY; the UI then tells the user to press Ctrl/⌘V in Zed. Opt in
//     with autopaste=1 to ALSO fire a synthetic Ctrl+V — but that key lands wherever Zed has focus, so
//     it disrupts the editor when focus isn't a text input (project panel, a code buffer). Off by
//     default for exactly that reason; use it only when the paste target is known. The clipboard is
//     ALWAYS set; a paste failure never fails the request.
const { spawn } = require("child_process")
const { tokenEq } = require("./sessionAuth")

// The KasmVNC X display start-zed.mjs pins (":90" → /tmp/.X11-unix/X90). Same default here so the
// clipboard lands on the display the user is actually looking at.
const ZED_DISPLAY = process.env.OYREN_ZED_DISPLAY || ":90"
const MAX_BYTES = 10 * 1024 * 1024
// xclip needs a concrete target atom; these are the image types a browser clipboard/DataTransfer
// realistically produces. Anything else is rejected rather than guessed at.
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

const decode = (s) => { try { return decodeURIComponent(s) } catch { return s } }

/** Token from `/_oyren/zed-clipboard/<token>` — segment 3, "" when absent (auth then rejects it). */
function tokenFromUrl(rawUrl) {
  const path = String(rawUrl || "/").split("?")[0]
  return decode(path.split("/")[3] || "")
}

// Opt-in: a blind synthetic Ctrl+V into whatever Zed has focused disrupts the editor unless the
// target is a text input, so the default is clipboard-only and the user presses Ctrl/⌘V themselves.
function wantsAutopaste(rawUrl) {
  try {
    return new URL(rawUrl || "/", "http://localhost").searchParams.get("autopaste") === "1"
  } catch {
    return false
  }
}

/** MIME off the Content-Type header, params stripped and lowercased. */
function mimeOf(req) {
  return String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase()
}

/**
 * Set the CLIPBOARD selection to `buf` (owned by xclip's background process), then optionally send
 * Ctrl+V. Injectable `runner` for tests — defaults to spawning the real binaries on ZED_DISPLAY.
 * Calls back with an Error only when the clipboard itself could not be set; auto-paste failures are
 * swallowed (clipboard is already set, the user can paste manually).
 */
function injectClipboard(buf, mime, { autopaste, runner = defaultRunner }, cb) {
  runner("xclip", ["-selection", "clipboard", "-t", mime], buf, (err) => {
    if (err) return cb(err)
    if (!autopaste) return cb(null)
    // --clearmodifiers so a modifier the user is still holding on the VNC side can't corrupt the
    // chord. No window search: Zed runs maximized under openbox as the only app, so it has focus.
    runner("xdotool", ["key", "--clearmodifiers", "ctrl+v"], null, () => cb(null))
  })
}

/** Spawn `cmd args` on the Zed display, feed `input` (Buffer|null) to stdin, resolve on clean exit. */
function defaultRunner(cmd, args, input, done) {
  let child
  try {
    child = spawn(cmd, args, { env: { ...process.env, DISPLAY: ZED_DISPLAY } })
  } catch (e) {
    return done(e)
  }
  let stderr = ""
  child.stderr.on("data", (d) => { stderr += d.toString("utf8") })
  child.on("error", (e) => done(e)) // ENOENT: the binary isn't in the snapshot
  child.on("exit", (code) => done(code === 0 ? null : new Error(`${cmd} exited ${code}: ${stderr.trim()}`)))
  // EPIPE if the child died before draining stdin — the exit handler already carries the real reason.
  child.stdin.on("error", () => {})
  if (input) child.stdin.end(input)
  else child.stdin.end()
}

// The capture control that calls this runs in the OYREN APP origin (the chrome around the stream),
// not inside the KasmVNC iframe, so its POST is cross-origin. The path token is the only secret, so a
// wildcard ACAO leaks nothing — anyone without the token gets 401 regardless. An image/* body is not
// a CORS-safelisted content-type, so the browser preflights; answer OPTIONS before anything else.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
}

function handleZedClipboard(req, res, { sessionToken, runner }) {
  const send = (code, body) => {
    res.writeHead(code, { "content-type": "application/json", ...CORS })
    res.end(JSON.stringify(body))
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS)
    return res.end()
  }
  if (req.method !== "POST") return send(405, { error: "method not allowed" })
  if (!tokenEq(tokenFromUrl(req.url), sessionToken)) return send(401, { error: "unauthorized" })
  const mime = mimeOf(req)
  if (!ALLOWED_MIME.has(mime)) return send(415, { error: "unsupported media type" })

  const chunks = []
  let size = 0
  let aborted = false
  req.on("data", (c) => {
    if (aborted) return
    size += c.length
    if (size > MAX_BYTES) {
      aborted = true
      send(413, { error: "image too large" })
      req.destroy()
      return
    }
    chunks.push(c)
  })
  req.on("end", () => {
    if (aborted) return
    const buf = Buffer.concat(chunks)
    if (buf.length === 0) return send(400, { error: "empty body" })
    injectClipboard(buf, mime, { autopaste: wantsAutopaste(req.url), runner }, (err) => {
      if (err) return send(502, { error: err.message })
      send(200, { ok: true, bytes: buf.length })
    })
  })
  req.on("error", () => { if (!aborted) send(400, { error: "read error" }) })
}

module.exports = { handleZedClipboard, injectClipboard, tokenFromUrl, wantsAutopaste, mimeOf, ALLOWED_MIME }
