// This session's shadow-ref name, in its own module so gitCheckpoint, agentMeta*, agentRecovery and
// seedRuntimeGuidance can all share it without require cycles.
function checkpointRef(env = process.env) {
  return `oyren/checkpoint-${env.OYREN_SESSION_SLUG || env.OYREN_SESSION_UUID || "session"}`
}

module.exports = { checkpointRef }
