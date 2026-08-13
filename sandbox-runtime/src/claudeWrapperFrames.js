// Broker-side alias for the shared wire format. The claude-wrapper/ directory is installed
// STANDALONE under /usr/local/lib/oyren-claude-wrapper (no src/ tree travels with it), so the
// encoder/decoder live there; the broker — which always runs from $APP_DIR with the full tree —
// re-exports instead of keeping a duplicate.
module.exports = require("../claude-wrapper/frames")
