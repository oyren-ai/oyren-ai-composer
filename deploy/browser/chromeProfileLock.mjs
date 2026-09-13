// Breaking a Chrome profile lock left behind by a container that no longer exists.
//
// The browser's profile is deliberately persistent ($HOME/.oyren-browser, see start-browser.mjs):
// that is what makes an idle stop cheap, because a Google or GitHub login completed before the
// timeout is still there when the next `oyren-open` starts Chrome again. The profile therefore
// outlives not just the process but the HOST — a Codespace is replaced and the same disk comes
// back under a new hostname.
//
// Chrome guards a profile against two Chromes with `SingletonLock`, a symlink whose target is
// `<hostname>-<pid>`. On the SAME host it self-heals: it reads the pid, sees it is gone, breaks the
// lock and starts. Across hosts it cannot check liveness of a pid on a machine it is not, so it
// refuses outright — "The profile appears to be in use by another Chromium process (N) on another
// computer (H)" — and exits 21. supervise() reads any child death as fatal, exits 1, and
// Restart=on-failure relaunches every 3s: a permanent crash loop, a Browser window that can never
// come up again, from a lock written by a droplet that was destroyed days ago.
//
// So the launcher does for the cross-host case what Chrome already does for the same-host one.
// Same shape as cleanStaleDisplay() for the stale X socket, and the same rule — remove ONLY what
// provably has no owner. A lock naming a live pid on THIS host is a real Chrome holding a real
// profile, and it is left exactly where it is.
import { readlinkSync, rmSync } from 'node:fs'
import { hostname } from 'node:os'

/** The three files Chrome writes together to claim a profile; they are broken together too. */
const SINGLETON_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket']

/** `<hostname>-<pid>` → its parts, or null if it is not that. Split at the LAST dash: our hostnames
 *  are full of them (oyren-app-tktevm-nh96-1099758), the pid never is. */
export function readLockOwner(target) {
  const match = /^(.+)-(\d+)$/.exec(String(target ?? '').trim())
  return match ? { host: match[1], pid: Number(match[2]) } : null
}

/** Does this process exist? EPERM means it does and is somebody else's — still alive, still an owner. */
function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e?.code === 'EPERM'
  }
}

/**
 * Can the Chrome named by this lock target still be running here?
 *
 * Stale — safe to break — in three cases: the lock names another machine (nothing on this host can
 * be it, and this is the case Chrome itself gives up on); the pid is gone; or the target is not a
 * `<hostname>-<pid>` at all, which no live Chrome ever writes. Anything else is a live owner.
 */
export function isStaleLock(target, { host, alive = pidAlive }) {
  const owner = readLockOwner(target)
  if (!owner) return true
  if (owner.host !== host) return true
  return !alive(owner.pid)
}

/**
 * Break the profile's singleton lock if nothing can still own it.
 *
 * @returns the dead lock's target when one was cleared, else null — the launcher logs it, because
 *          "your browser is starting fresh from a lock left by <other host>" is the only trace the
 *          user would otherwise have of why a stack that had been looping suddenly works.
 */
export function clearStaleProfileLock(profileDir, deps = {}) {
  const {
    host = hostname(),
    alive = pidAlive,
    readLink = (p) => readlinkSync(p),
    remove = (p) => rmSync(p, { force: true }),
  } = deps
  let target = null
  try {
    target = readLink(`${profileDir}/SingletonLock`)
  } catch (e) {
    // No lock at all is the normal first start. Anything else present but unreadable as a symlink
    // (a stray regular file) is a profile no Chrome can open either, so it falls through as stale.
    if (e?.code === 'ENOENT') return null
  }
  if (!isStaleLock(target, { host, alive })) return null
  for (const name of SINGLETON_FILES) remove(`${profileDir}/${name}`)
  return target
}
