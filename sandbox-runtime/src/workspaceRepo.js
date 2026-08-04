// Locate the session's cloned git repo on disk. entrypoint.sh clones each repo into
// /workspace/<repo-name> and points WORKING_DIR/WORKDIR at the primary; a "Top level" multi-repo
// launch keeps WORKDIR=/workspace with the clones as immediate children. Both layouts resolve here:
// the workdir itself when it is a repo root, else the first child directory that is one. Used by the
// blank-boot recovery preamble (agentRecovery), the auto-checkpoint timer (gitCheckpoint) and the
// runtime-guidance seeding (seedRuntimeGuidance) to decide "is there a git repo to be durable in".
const fs = require("fs")
const path = require("path")

const isRepoRoot = (dir) => { try { return fs.existsSync(path.join(dir, ".git")) } catch { return false } }

/** The agent's working directory, same resolution order as spawnConfig/agent-launch.sh. */
function workdirFrom(env = process.env) {
  return env.WORKING_DIR || env.WORKDIR || "/workspace"
}

/** EVERY repo dir of this session ([workdir] when it is itself a repo root, else all repo children,
 *  sorted for determinism), or [] when repo-less. Multi-repo launches clone several. */
function findGitRepoDirs(workdir = workdirFrom()) {
  if (isRepoRoot(workdir)) return [workdir]
  try {
    return fs.readdirSync(workdir).sort().map((name) => path.join(workdir, name)).filter(isRepoRoot)
  } catch { return [] /* missing/unreadable workdir = repo-less session */ }
}

/** The PRIMARY repo dir (first of findGitRepoDirs), or null when repo-less. */
function findGitRepoDir(workdir = workdirFrom()) {
  return findGitRepoDirs(workdir)[0] || null
}

module.exports = { findGitRepoDir, findGitRepoDirs, workdirFrom }
