// The `update/status` control action: what the UI polls while an in-place update runs. It reads
// the two files the updater writes (deploy/update/) rather than asking a job, because the runtime
// itself restarts half-way through an update and a job id would come back `unknown`.
const fs = require("fs")
const { imageSummary } = require("./imageManifest")

const DEFAULT_STATUS_FILE = "/etc/oyren/update-status.json"

function readUpdateStatus({ file = process.env.OYREN_UPDATE_STATUS || DEFAULT_STATUS_FILE } = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"))
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

/** { image, update } — update is null when no update has ever run on this machine. */
function updateStatus(opts) {
  return { image: imageSummary(), update: readUpdateStatus(opts) }
}

module.exports = { readUpdateStatus, updateStatus, DEFAULT_STATUS_FILE }
