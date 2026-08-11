// Used by startClaudeWrapperBroker.js (server.js runs from $APP_DIR with this src/ tree intact, so
// the relative require resolves). claude-process-wrapper.js CANNOT share this module — install-
// runtime.sh installs it standalone at /usr/local/bin/oyren-claude-wrapper with no sibling src/ tree
// — so it keeps a literal duplicate of DEFAULT_SOCKET_PATH instead. Keep the two in sync.
//
// /tmp, not /run/oyren: the latter would need a systemd RuntimeDirectory= addition (the oyren user
// can't create subdirectories under /run itself) — reasonable v1.1 hardening, not needed for v1.
// Matches ensureHomeWritable.js's existing /tmp/oyren-cache naming. Every process in a session VM
// already runs as the single trusted `oyren` user (machine-settings.json's own security note: the
// boundary is the VM + that user, same as SageMaker/Cloud Shell/Gitpod/Coder) — /tmp is not a
// cross-tenant boundary here the way it would be on a shared multi-user host.
const DEFAULT_SOCKET_PATH = process.env.OYREN_CLAUDE_WRAPPER_SOCKET || "/tmp/oyren-claude-wrapper.sock"

module.exports = { DEFAULT_SOCKET_PATH }
