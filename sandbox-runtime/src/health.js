// /_oyren/health: always 200, NEVER proxied — DO's health check must pass during long builds, and
// the edge probes it on the dsh host too, so one writer serves every hostname the router answers on.
function writeHealth(res) {
  res.writeHead(200, { "content-type": "application/json" })
  // buildId is baked into each image at build time (ARG/ENV BUILD_ID) so a running container reveals
  // exactly which image it booted — the reliable way to tell a fresh launch from a stale cached one.
  return res.end(JSON.stringify({ status: "healthy", service: "oyren-sandbox", buildId: process.env.BUILD_ID || "unknown" }))
}

module.exports = { writeHealth }
