// Shared credential-file writers for the per-provider seed modules (seedAgentAuth.js,
// seedOpencodeConfig.js). Every file a CLI reads its auth from lands at 0600, and JSON files are
// merged rather than clobbered so a hand-edit inside the container survives a re-seed.
const fs = require("fs")
const path = require("path")

function writeSecret(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, { mode: 0o600 })
  fs.chmodSync(file, 0o600) // writeFileSync's mode only applies on create; keep re-runs at 0600 too
}

/**
 * Shallow-per-level merge of a JSON file: existing keys survive, patch keys win, objects recurse.
 * `drop` names top-level keys to delete first — for retiring a key a previous image version wrote,
 * which a merge alone would preserve forever (e.g. opencode's pre-1.0 `providers`/`agents`, which the
 * current CLI rejects outright as "Configuration is invalid ... Unrecognized keys").
 */
function mergeJsonFile(file, patch, drop = []) {
  let current = {}
  try {
    current = JSON.parse(fs.readFileSync(file, "utf8")) || {}
  } catch {
    current = {}
  }
  for (const key of drop) delete current[key]
  const merge = (base, over) => {
    const out = { ...base }
    for (const [k, v] of Object.entries(over)) {
      out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" ? merge(base[k], v) : v
    }
    return out
  }
  writeSecret(file, JSON.stringify(merge(current, patch), null, 2))
}

module.exports = { writeSecret, mergeJsonFile }
