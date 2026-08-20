// Switch this session's editor surface while it is running: streamed Zed, or the in-browser VS
// Code. Exactly one at a time.
//
// WHY NOT BOTH: the tiers that can host software-rendered Zed are large, but KasmVNC's X server is
// the heaviest process on the box by far (and grows), so leaving it running behind a VS Code tab
// buys nothing and costs GBs. Stopping the surface you left is the whole point of switching.
//
// HOW IT WORKS: the launchers gate on /etc/oyren/editor-surface (deploy/sandbox-host/
// editorSurface.mjs), which OUTRANKS the launch env. So a switch is: write the file, stop the unit
// you are leaving, start the one you want. Writing FIRST is load-bearing — `systemctl start
// oyren-zed` on a session launched as vscode exits 0 immediately unless the file already says zed.
//
// PRIVILEGE: the sandbox user has NOPASSWD sudo (the same grant Claude Code's bypassPermissions
// notes), so systemd and /etc/oyren are reachable without running the runtime as root.
const { execFile } = require("child_process")

/** MUST MATCH SURFACE_FILE in deploy/sandbox-host/editorSurface.mjs — the launchers read it. */
const SURFACE_FILE = "/etc/oyren/editor-surface"

/** The unit behind each surface. Order of operations is stop-other-then-start-wanted. */
const UNITS = { zed: "oyren-zed.service", vscode: "oyren-editor.service" }

/** Surfaces a caller may ask for. "none" is a resolved state (the OYREN_EDITOR=0 kill switch), so
 *  it is deliberately not switchable — nothing would be left to switch back with. */
const SURFACES = Object.keys(UNITS)

/** Run a command, resolving with its exit code + output instead of throwing (a `systemctl stop` of
 *  an already-stopped unit is a normal outcome, not an error). Injectable for tests. */
function defaultExec(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 60_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout || ""), stderr: String(stderr || "") })
    })
  })
}

/** `systemctl is-active` per unit, plus what the surface file currently says. */
async function surfaceStatus({ exec = defaultExec } = {}) {
  const units = {}
  for (const [surface, unit] of Object.entries(UNITS)) {
    const { stdout } = await exec("systemctl", ["is-active", unit])
    units[surface] = stdout.trim() || "unknown"
  }
  const { stdout } = await exec("cat", [SURFACE_FILE])
  const written = stdout.trim().toLowerCase()
  return { surface: SURFACES.includes(written) ? written : null, units }
}

/**
 * Point the session at `surface`. Idempotent: switching to the surface already running just
 * re-asserts the file and (re)starts the unit, which is what makes it safe to call on every
 * page load. Returns the post-switch status so the caller never has to poll a second endpoint.
 *
 * A failed START is an error the caller must see (the user is staring at a blank pane); a failed
 * STOP is not — the surface they asked for is up, and a stuck unit is the reaper's problem.
 */
async function switchSurface(surface, { exec = defaultExec } = {}) {
  const wanted = String(surface || "").trim().toLowerCase()
  if (!SURFACES.includes(wanted)) {
    return { ok: false, error: `surface must be one of ${SURFACES.join(", ")}`, status: 400 }
  }
  // Written before anything starts: the launchers' gate reads this file, so a start would otherwise
  // exit 0 on a session whose LAUNCH env chose the other surface.
  const write = await exec("sudo", ["-n", "sh", "-c", `printf '%s\\n' ${wanted} > ${SURFACE_FILE}`])
  if (write.code !== 0) {
    return { ok: false, error: `could not record the surface: ${write.stderr.trim() || `exit ${write.code}`}`, status: 500 }
  }
  const leaving = SURFACES.filter((s) => s !== wanted)
  for (const other of leaving) await exec("sudo", ["-n", "systemctl", "stop", UNITS[other]])
  const start = await exec("sudo", ["-n", "systemctl", "start", UNITS[wanted]])
  if (start.code !== 0) {
    return { ok: false, error: `could not start ${UNITS[wanted]}: ${start.stderr.trim() || `exit ${start.code}`}`, status: 500 }
  }
  return { ok: true, ...(await surfaceStatus({ exec })) }
}

module.exports = { switchSurface, surfaceStatus, SURFACE_FILE, SURFACES, UNITS }
