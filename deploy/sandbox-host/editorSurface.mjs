// Which editor surface this droplet runs: streamed Zed, the in-browser VS Code, or neither.
//
// The LAUNCH choice arrives in the session env — the orchestrator sets OYREN_ZED=1 + OYREN_EDITOR=0
// together for a zed-web launch — but the surface is now switchable while the session is alive
// (control action `editor/switch`). A switch writes SURFACE_FILE, which OUTRANKS the launch env, so
// the choice survives a unit restart and a droplet reboot without the orchestrator having to
// re-deliver a different session env.
//
// Both launchers resolve through here and each exits 0 when it is not the chosen surface, which is
// what makes `systemctl start oyren-zed` on a session launched as vscode actually start Zed: the
// switch writes the file first, so the gate now agrees.
//
// Exactly one surface runs at a time, deliberately: KasmVNC + software-rendered Zed is the heaviest
// thing on the box (and leaks), and the tiers that can host it are the ones already large enough
// that ~400MB of idle VS Code alongside it is pure waste.
import { readFileSync } from 'node:fs'

/** Root-owned, alongside the other /etc/oyren state cloud-init writes. The runtime writes it with
 *  sudo (see sandbox-runtime/src/editorSurface.js) — MUST MATCH the path there. */
export const SURFACE_FILE = '/etc/oyren/editor-surface'

export const ZED = 'zed'
export const VSCODE = 'vscode'
/** Neither surface: the OYREN_EDITOR=0 kill switch on a session that never asked for Zed. */
export const NONE = 'none'

/** The surfaces a switch may ask for. NONE is a resolved state, never a request. */
export const SWITCHABLE = [ZED, VSCODE]

/** File contents → a surface, or null when absent/garbage (⇒ fall back to the launch env). */
export function parseSurfaceFile(contents) {
  const word = String(contents ?? '').trim().toLowerCase()
  return SWITCHABLE.includes(word) ? word : null
}

/**
 * Resolve the surface: the switched-to one if a valid file exists, else the launch env.
 *
 * Launch-env reading, in order: OYREN_ZED=1 ⇒ zed (the orchestrator only ever sets it for zed-web);
 * OYREN_EDITOR=0 ⇒ none (the small-tier kill switch, which must keep meaning "no editor" for a
 * session that never chose Zed); otherwise vscode, the default surface.
 */
export function resolveSurface(env = {}, fileContents = null) {
  const switched = parseSurfaceFile(fileContents)
  if (switched) return switched
  if (env.OYREN_ZED === '1') return ZED
  if (env.OYREN_EDITOR === '0') return NONE
  return VSCODE
}

/** resolveSurface against the real file — missing/unreadable reads as "never switched". */
export function currentSurface(env, file = SURFACE_FILE) {
  let contents = null
  try {
    contents = readFileSync(file, 'utf8')
  } catch {
    /* not switched yet (or unreadable): the launch env decides */
  }
  return resolveSurface(env, contents)
}
