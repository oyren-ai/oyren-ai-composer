// Environment for spawned USER-CODE children (supervisor start, control/run, run_stream).
// The platform's own control secrets must NEVER be inherited by processes running the user's
// repo code: a log line, crash report, or third-party dependency that prints process.env
// would leak a token that unlocks the whole session (terminal root shell, agent control,
// downloads, fresh GitHub token minting). Apps still receive the user's visible environment
// (BYOK keys, etc.) — only the session-control tokens are scrubbed.
const DENYLIST = ["SESSION_TOKEN", "CONTROL_TOKEN", "GITHUB_TOKEN"]

function appEnv(base = process.env) {
  const env = { ...base }
  for (const key of DENYLIST) delete env[key]
  return env
}

module.exports = { appEnv, DENYLIST }