const fs = require("fs")
const os = require("os")
const path = require("path")
const { execFileSync } = require("child_process")

// HOME itself, plus the two dirs every CLI agent's own runtime `mkdir -p` writes into (opencode's
// ~/.cache/opencode + ~/.config/opencode, codex's/gemini's/qwen's dotfiles, etc. all nest under one of
// these). If a prior process left one of these — or something nested inside it — owned by root (e.g. a
// `sudo` invocation that preserved HOME instead of resetting it to /root, or a platform volume remount),
// the CLI's own mkdir throws EACCES even though the container otherwise runs unprivileged as `oyren`.
// See: "EACCES: permission denied, mkdir '/home/oyren/.cache/opencode'".
const WATCHED = [".", ".cache", ".config"]

function isWritable(dir) {
  try {
    fs.accessSync(dir, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

// Reclaim a dir via sudo (the sandbox user has passwordless NOPASSWD:ALL sudo — see oyren-sandbox's
// Dockerfile). `mkdir -p` first covers the dir not existing at all yet (e.g. a fresh volume mount whose
// root is owned by someone else, so even creating the first level fails as a non-root user); `chown -R`
// then fixes ownership all the way down, including any nested dir (like `.cache/opencode`) a previous
// root-run process may have left behind.
function reclaim(dir, uid, gid, execImpl) {
  try {
    execImpl("sudo", ["mkdir", "-p", dir])
    execImpl("sudo", ["chown", "-R", `${uid}:${gid}`, dir])
    return true
  } catch {
    return false
  }
}

const defaultExec = (cmd, args) => execFileSync(cmd, args, { stdio: "ignore" })

// Privilege-free last resort, for when `reclaim` above can't run at all: DigitalOcean App Platform
// starts containers with `no-new-privileges`, under which sudo refuses outright ("the 'no new
// privileges' flag is set") — so the whole sudo repair is a silent no-op in the one environment this
// file exists for. Redirect the XDG cache instead: a CLI that honours it then builds its cache
// somewhere writable rather than dying on `mkdir ~/.cache/<name>`.
//
// .cache ONLY. HOME itself is `oyren`-owned, so ~/.config is creatable as-is, and pointing
// XDG_CONFIG_HOME elsewhere would silently decouple the CLIs from where seedAgentAuth writes their
// provider configs.
const CACHE_FALLBACK = "/tmp/oyren-cache"

/** Whether ~/.cache is usable after the repair pass: creatable if missing, and writable either way. */
function cacheUsable(home) {
  const dir = path.join(home, ".cache")
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    return false
  }
  return isWritable(dir)
}

function redirectCache(env, dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    if (!isWritable(dir)) return false
    env.XDG_CACHE_HOME = dir
    return true
  } catch {
    return false
  }
}

/**
 * Best-effort self-heal for a HOME whose `.cache`/`.config` (or HOME itself) got left root-owned by a
 * prior process. Called before every ACP child spawn (acpEngine.js) and as the first seed step in
 * agent-launch.sh, so either entry point recovers regardless of which one runs first. Idempotent and a
 * silent no-op on the healthy path (the overwhelmingly common case) — only shells out to `sudo` when a
 * watched dir is actually unwritable. Never throws: a failed repair must not block agent boot.
 *
 * Returns whether any repair was attempted (for tests/logging), not whether it fully succeeded. When
 * ~/.cache survives the repair still unwritable, `env.XDG_CACHE_HOME` is pointed at a writable
 * fallback as a side effect — agent-launch.sh reads it back out to export it for the tmux agent.
 */
function ensureHomeWritable({
  home = process.env.HOME || os.homedir(),
  uid = typeof process.getuid === "function" ? process.getuid() : null,
  gid = typeof process.getgid === "function" ? process.getgid() : null,
  execImpl = defaultExec,
  env = process.env,
  cacheFallback = CACHE_FALLBACK,
} = {}) {
  if (uid == null || gid == null) return false // no POSIX ids (non-Linux) — nothing safe to chown to
  let repaired = false
  for (const sub of WATCHED) {
    const dir = path.join(home, sub)
    try {
      fs.mkdirSync(dir, { recursive: true })
      if (isWritable(dir)) continue
    } catch {
      // mkdir itself threw (e.g. an ancestor is unwritable) — fall through to repair below
    }
    if (reclaim(dir, uid, gid, execImpl)) repaired = true
  }
  // The repair is best-effort and can't succeed without privileges; check the outcome, not the attempt.
  if (!cacheUsable(home) && redirectCache(env, cacheFallback)) repaired = true
  return repaired
}

module.exports = { ensureHomeWritable }
