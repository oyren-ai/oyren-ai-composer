// `oyren version`: which Oyren image this machine runs, from /etc/oyren/image-manifest.json, plus
// the state of the last in-place update when one has run.
const { readImageManifest } = require("../imageManifest")
const { readUpdateStatus } = require("../controlUpdate")
const { formatStatus, formatVersion } = require("./updateFormat")

async function versionCommand(args, { stdout = (s) => process.stdout.write(s) } = {}) {
  const manifest = readImageManifest()
  const update = readUpdateStatus()
  if (args.includes("--json")) {
    stdout(JSON.stringify({ image: manifest, update }, null, 2) + "\n")
    return manifest ? 0 : 1
  }
  stdout(formatVersion(manifest) + "\n")
  if (update && update.state && update.state !== "idle") stdout(`last update: ${formatStatus(update)}\n`)
  return manifest ? 0 : 1
}

module.exports = { versionCommand }
