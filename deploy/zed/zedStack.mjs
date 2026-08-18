// Helpers for start-zed.mjs, split out to keep both files small. Installed beside it in
// /usr/local/lib/oyren/ by deploy/zed/install-zed.sh.
import { existsSync, rmSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

// KasmVNC has renamed its X server binary across releases (Xvnc → Xkasmvnc). install-zed-stack.sh
// asserts one of these exists at bake time; resolving both here keeps the launcher working across
// a KasmVNC bump without an edit.
const XVNC_CANDIDATES = ['/usr/bin/Xkasmvnc', '/usr/bin/Xvnc']

export function resolveXvncBin() {
  const found = XVNC_CANDIDATES.find((p) => existsSync(p))
  if (!found) throw new Error(`no KasmVNC X server binary found (tried ${XVNC_CANDIDATES.join(', ')})`)
  return found
}

/** Remove a dead Xvnc's leftovers before spawning a fresh one. The X socket survives any unclean
 *  X death (only a clean shutdown unlinks it), so waitForFile would see the STALE socket, start
 *  openbox against it, and race the still-initializing Xvnc into a restart loop; a stale lock
 *  file whose PID got recycled would make the new Xvnc refuse the display outright. Both are
 *  owned by the oyren user, so removal works; ENOENT is the normal case (force). */
export function cleanStaleDisplay(display) {
  const n = display.slice(1) // ':90' → '90'
  for (const p of [`/tmp/.X11-unix/X${n}`, `/tmp/.X${n}-lock`]) rmSync(p, { force: true })
}

/** Poll for a file (the X display socket) — rejects on timeout, which exits the launcher non-zero
 *  and lets systemd restart the whole stack. */
export async function waitForFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${path}`)
    await sleep(200)
  }
}
