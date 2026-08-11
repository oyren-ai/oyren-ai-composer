// Runtime configuration for the oyren-sandbox server, read once from the environment.
// PORT is the single port DigitalOcean routes to; SESSION_TOKEN gates the terminal WS;
// CONTROL_TOKEN gates the `/_oyren/control/*` API (orchestrator + the in-container `oyren` CLI).
const path = require("path")

const PORT = Number(process.env.PORT || 8080)
const SESSION_TOKEN = process.env.SESSION_TOKEN || ""
const CONTROL_TOKEN = process.env.CONTROL_TOKEN || ""
// Repos live under the sandbox user's home so the browser editor — running as that same user — owns
// everything it writes. /workspace stays a symlink to this, so paths baked into skills and
// AGENTS.md files keep resolving.
const WORKSPACE_DIR = process.env.OYREN_WORKSPACE_DIR || "/home/oyren/workspace"
const WORKDIR = process.env.WORKDIR || WORKSPACE_DIR
const OYREN_MODE = process.env.OYREN_MODE === "dev" ? "dev" : "prod"

// Bundled alongside the server: the static how-to-deploy site and the manifest resolver.
const STATIC_DIR = path.join(__dirname, "..", "web")
const RESOLVE_SCRIPT = path.join(__dirname, "..", "runner", "oyren-resolve.mjs")

module.exports = {
  PORT,
  SESSION_TOKEN,
  CONTROL_TOKEN,
  WORKSPACE_DIR,
  WORKDIR,
  OYREN_MODE,
  STATIC_DIR,
  RESOLVE_SCRIPT,
}
