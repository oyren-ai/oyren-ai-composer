// The image manifest a bake stamps into /etc/oyren/image-manifest.json (deploy/manifest/). The
// runtime only READS it: health and the control API report which image this droplet runs, and
// `oyren update` diffs it against the newest release. Re-read whenever the file's mtime moves, so
// an in-place update that never restarts the runtime (an agent-CLI bump, say) still shows up.
const fs = require("fs")

const DEFAULT_FILE = "/etc/oyren/image-manifest.json"
let cache = { file: null, mtimeMs: null, manifest: null }

function manifestFile() {
  return process.env.OYREN_IMAGE_MANIFEST || DEFAULT_FILE
}

/** The parsed manifest, or null when the image predates manifests or the file is unreadable. */
function readImageManifest({ file = manifestFile() } = {}) {
  let mtimeMs
  try { mtimeMs = fs.statSync(file).mtimeMs } catch { cache = { file, mtimeMs: null, manifest: null }; return null }
  if (cache.file === file && cache.mtimeMs === mtimeMs) return cache.manifest
  let manifest = null
  try { manifest = JSON.parse(fs.readFileSync(file, "utf8")) } catch { manifest = null }
  if (manifest && typeof manifest !== "object") manifest = null
  cache = { file, mtimeMs, manifest }
  return manifest
}

/** The short form health and `status` carry. `runtime` is the hash of the runtime tree, which is
 *  what a caller compares to know whether a restart actually landed the new runtime. */
function imageSummary(opts) {
  const m = readImageManifest(opts)
  if (!m) return null
  const components = m.components || {}
  return {
    version: m.version ?? null,
    family: m.family ?? null,
    builtAt: m.builtAt ?? null,
    composerSha: m.composerSha ?? null,
    runtime: components.runtime ?? null,
  }
}

module.exports = { readImageManifest, imageSummary, DEFAULT_FILE }
