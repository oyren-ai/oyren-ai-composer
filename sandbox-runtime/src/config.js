// Runtime configuration for the oyren-sandbox server, read once from the environment.
// PORT is the single port DigitalOcean routes to; SESSION_TOKEN gates the terminal WS;
// CONTROL_TOKEN gates the `/_oyren/control/*` API (orchestrator + the in-container `oyren` CLI).
const path = require("path")

const PORT = Number(process.env.PORT || 8080)
const SESSION_TOKEN = process.env.SESSION_TOKEN || ""
const CONTROL_TOKEN = process.env.CONTROL_TOKEN || ""
const WORKDIR = process.env.WORKDIR || "/workspace"
const OYREN_MODE = process.env.OYREN_MODE === "dev" ? "dev" : "prod"

// Bundled alongside the server: the static how-to-deploy site and the manifest resolver.
const STATIC_DIR = path.join(__dirname, "..", "web")
const RESOLVE_SCRIPT = path.join(__dirname, "..", "runner", "oyren-resolve.mjs")

module.exports = { PORT, SESSION_TOKEN, CONTROL_TOKEN, WORKDIR, OYREN_MODE, STATIC_DIR, RESOLVE_SCRIPT }
