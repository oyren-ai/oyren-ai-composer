// Idle detection for the in-VM browser stack (start-browser.mjs).
//
// The browser is on-demand — a Chrome plus an X server is ~300MB resident — so a session that
// opened it once for a two-minute OAuth login should not keep paying for it all day. The stack
// therefore stops itself once nobody has been watching for a while.
//
// WHY NOT KasmVNC's own -MaxIdleTime/-MaxDisconnectionTime: those make Xvnc EXIT, which the
// launcher (correctly) treats as a crash — exit 1, and the unit's Restart=on-failure brings the
// whole stack straight back. That turns an idle timeout into a respawn loop. Deciding here instead
// lets the launcher exit 0, which is what makes systemd leave it down until `oyren-open` asks again.
//
// "Watching" = an ESTABLISHED TCP connection to the KasmVNC websocket port. The viewer arrives
// through the sandbox router on the same host (proxyWs → 127.0.0.1:<port>), so every viewer is one
// loopback socket and /proc/net/tcp is the whole truth — no KasmVNC API, no extra dependency, and
// countViewers() is a pure function over that text, which is what makes this testable at all.
//
// Stopping is cheap BECAUSE the profile is on disk ($HOME/.oyren-browser): a Google or GitHub login
// completed before the timeout is still there when the next `oyren-open` starts Chrome again. The
// timeout costs a restart, never a re-login.

/** Rows in /proc/net/tcp whose LOCAL port is `port` and whose state is ESTABLISHED (01).
 *  The listening socket itself is state 0A and is deliberately not counted — a listener with no
 *  clients is exactly the idle case. Handles both /proc/net/tcp and /proc/net/tcp6 (the address
 *  column width differs; only the part after the colon is read). */
export function countViewers(procNetTcp, port) {
  const wanted = port.toString(16).toUpperCase().padStart(4, "0")
  let n = 0
  for (const line of String(procNetTcp || "").split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 4) continue
    const [, local, , state] = cols
    const localPort = local.split(":")[1]
    if (localPort === wanted && state === "01") n++
  }
  return n
}

/**
 * A tick function that answers "should the stack stop now?".
 *
 * The clock starts at creation, not at first connect: a stack nobody ever opens must also time out
 * (a crashed browser tab, a `oyren-open` in a script that no human followed). Any viewer at any tick
 * resets it, so a long login with the tab open never trips, and a brief WebSocket drop mid-login
 * only costs one tick's worth of the window rather than the session.
 *
 * `idleMs <= 0` disables the timeout entirely (OYREN_BROWSER_IDLE_MINUTES=0), for a session that
 * wants the browser pinned up.
 */
export function createIdleWatch({ port, idleMs, now = () => Date.now(), readProc }) {
  let lastSeen = now()
  return {
    /** @returns {{ idle: boolean, viewers: number, idleMs: number }} */
    tick() {
      const viewers = countViewers(readProc(), port)
      const t = now()
      if (viewers > 0) lastSeen = t
      const idleFor = t - lastSeen
      return { idle: idleMs > 0 && idleFor >= idleMs, viewers, idleMs: idleFor }
    },
  }
}
