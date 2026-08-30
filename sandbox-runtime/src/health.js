// /_oyren/health: always 200, NEVER proxied — DO's health check must pass during long builds, and
// the edge probes it on the dsh host too, so one writer serves every hostname the router answers on.
const { imageSummary } = require("./imageManifest")
const { tmuxUnitState } = require("./tmuxUnit")

function writeHealth(res) {
  res.writeHead(200, { "content-type": "application/json" })
  // Which bake this droplet runs, from /etc/oyren/image-manifest.json: the version stamp, the
  // family, and the runtime tree's hash (what an updater polls to see its restart landed). Null on
  // images that predate manifests. buildId is the Docker-era field, kept for older readers.
  const image = imageSummary()
  return res.end(JSON.stringify({
    status: "healthy",
    service: "oyren-sandbox",
    buildId: process.env.BUILD_ID || "unknown",
    imageVersion: image ? image.version : null,
    imageFamily: image ? image.family : null,
    runtime: image ? image.runtime : null,
    // Whether the dedicated tmux unit holds the session's server. "failed" here means panes are
    // living in an ad-hoc server inside this process's cgroup and will die with the next runtime
    // restart: the exact incident of 2026-08-30. The promote smoke boot refuses such an image.
    tmuxUnit: tmuxUnitState(),
  }))
}

module.exports = { writeHealth }
