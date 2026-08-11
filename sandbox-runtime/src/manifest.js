// Read/merge/write the `port:` field of the repo's oyren.yml. Exposing a port persists it here
// (the user asked for "config for exposed ports added to oyren.yml") so a later managed start
// reflects it. A TS/JS manifest still wins for install/build/start commands (see oyren-resolve);
// the exposed port is authoritative from the expose call regardless.
const fs = require("fs")
const path = require("path")
const YAML = require("yaml")

const YAML_NAMES = ["oyren.yml", "oyren.yaml"]

/** Path of the existing YAML manifest, or the default `oyren.yml` to create. */
function manifestPath(dir) {
  for (const name of YAML_NAMES) {
    const p = path.join(dir, name)
    if (fs.existsSync(p)) return p
  }
  return path.join(dir, "oyren.yml")
}

function readManifest(dir) {
  const p = manifestPath(dir)
  if (!fs.existsSync(p)) return {}
  try {
    return YAML.parse(fs.readFileSync(p, "utf8")) || {}
  } catch {
    return {}
  }
}

/** Merge `port` into the YAML manifest, writing it to disk. Returns the merged config. */
function setManifestPort(dir, port) {
  const cfg = readManifest(dir)
  cfg.port = Number(port)
  fs.writeFileSync(manifestPath(dir), YAML.stringify(cfg))
  return cfg
}

module.exports = { manifestPath, readManifest, setManifestPort }
