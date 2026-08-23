// Server side of terminal image paste. The browser can't hand a file to a program running on the
// container PTY, so xterm ships a pasted screenshot to us as `{ type: "image", data: <base64> }`
// (see wireTerminalImagePaste.ts in oyren-ai-next). Here we persist those bytes to a file the
// container can read and then type its path onto the PTY — which is how Claude Code (or any program
// prompting for one) picks the image up. It works the same under tmux and a plain shell: `term.write`
// feeds the foreground program's stdin either way.
const fs = require("fs")
const os = require("os")
const path = require("path")

// A screenshot is comfortably under this; the cap just stops one paste from writing an absurd file.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

const EXT_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
}

/** Fixed, container-owned destination so a crafted client message can never steer the write path. */
function pasteDir() {
  return path.join(os.tmpdir(), "oyren-terminal-pastes")
}

function extForMime(mime) {
  return EXT_BY_MIME[String(mime || "").toLowerCase()] || "png"
}

/**
 * Persist a pasted image and type its absolute path onto the PTY. The client supplies ONLY the bytes
 * and mime — the directory and filename are chosen here, so there is no path-traversal surface. The
 * path is typed WITHOUT a trailing newline: Claude Code turns an image path in the prompt into an
 * attachment, and the user still reviews before hitting Enter; a plain shell just gets a harmless path
 * on its command line. Returns the written path, or null when the message carries nothing usable.
 */
function writePastedImage(term, msg, deps = {}) {
  const fsImpl = deps.fs || fs
  const dir = deps.dir || pasteDir()
  const now = deps.now || Date.now
  const rand = deps.rand || Math.random

  if (!msg || typeof msg.data !== "string" || msg.data.length === 0) return null
  let buf
  try {
    buf = Buffer.from(msg.data, "base64")
  } catch {
    return null
  }
  if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null

  const name = `paste-${now()}-${Math.floor(rand() * 1e6)}.${extForMime(msg.mime)}`
  const dest = path.join(dir, name)
  try {
    fsImpl.mkdirSync(dir, { recursive: true })
    fsImpl.writeFileSync(dest, buf)
  } catch (e) {
    console.error("[terminal] failed to write pasted image:", (e && e.message) || e)
    return null
  }
  // Trailing space so the next keystroke doesn't glue onto the filename.
  try {
    term.write(dest + " ")
  } catch {}
  return dest
}

module.exports = { writePastedImage, pasteDir, extForMime, MAX_IMAGE_BYTES }
