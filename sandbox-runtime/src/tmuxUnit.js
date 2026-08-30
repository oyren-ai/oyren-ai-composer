// Is the dedicated tmux unit (oyren-tmux.service) actually holding the session's server? For four
// days the answer was "no" on every droplet (the -D start-server argv bug) and NOTHING said so:
// terminals fell back to an ad-hoc server inside THIS process's cgroup, where a runtime restart or
// crash takes every pane. This module makes that state visible: health reports it, and terminal.js
// logs an error when a tmux attach happens over a dead unit.
//
// Reads are synchronous returns of the last probe (health must never block); a probe runs in the
// background at most once per TTL. `exec` is injectable for tests; systemctl missing (dev, tests,
// non-systemd hosts) reports "absent", which callers treat as "nothing to warn about".
const { execFile } = require("child_process")

const TTL_MS = 10_000
let last = { state: "unknown", at: 0 }
let probing = false

const defaultExec = (cmd, args, cb) => execFile(cmd, args, { timeout: 3_000 }, cb)

/** Last known unit state: "active" | "failed" | "inactive" | "absent" | "unknown". Kicks a
 *  background refresh when the value is older than TTL_MS. */
function tmuxUnitState({ exec = defaultExec, now = Date.now } = {}) {
  if (!probing && now() - last.at >= TTL_MS) {
    probing = true
    try {
      exec("systemctl", ["is-active", "oyren-tmux"], (err, stdout) => {
        probing = false
        const out = String(stdout || "").trim()
        // systemctl exits non-zero for every non-active state but still names it on stdout; a
        // missing binary (ENOENT) means this host has no unit to speak of.
        const state = err && err.code === "ENOENT" ? "absent" : out || (err ? "failed" : "unknown")
        last = { state, at: now() }
      })
    } catch {
      probing = false
      last = { state: "absent", at: now() }
    }
  }
  return last.state
}

/** Test seam: forget the cached state between cases. */
function __reset() { last = { state: "unknown", at: 0 }; probing = false }

module.exports = { tmuxUnitState, __reset, TTL_MS }
