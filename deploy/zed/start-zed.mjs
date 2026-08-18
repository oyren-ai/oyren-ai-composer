// systemd ExecStart for the streamed-Zed stack (oyren-zed.service): KasmVNC's X server + openbox
// + Zed, one supervised process tree. Runs only when the session env carries OYREN_ZED=1 — the
// orchestrator sets it solely for zed-web launches, so this image is inert everywhere else.
import { spawn } from 'node:child_process'
import { mergedEnv } from './sessionEnv.mjs'
import { cleanStaleDisplay, resolveXvncBin, waitForFile } from './zedStack.mjs'

const env = mergedEnv()
// Inverted opt-IN gate (contrast start-editor.mjs's OYREN_EDITOR=0 kill switch): exit 0 +
// Restart=on-failure in the unit = a non-zed session stays down cleanly, no respawn loop.
if (env.OYREN_ZED !== '1') {
  console.log('OYREN_ZED!=1 — zed stream disabled for this session')
  process.exit(0)
}
// Fail closed, same reasoning as start-editor.mjs: the router's session token is the ONLY gate on
// the no-auth KasmVNC listener. Exit 0, not 1 — Restart=on-failure would loop a permanent
// misconfiguration; a stack nobody can reach should just stay down.
if (!env.SESSION_TOKEN) {
  console.error('SESSION_TOKEN is not set — refusing to start the zed stream')
  process.exit(0)
}

const DISPLAY = ':90' // X socket /tmp/.X11-unix/X90; port-mnemonic for the 6090 listener
const WS_PORT = env.OYREN_ZED_PORT ?? '6090'
const WORKSPACE_DIR = env.OYREN_WORKSPACE_DIR ?? '/home/oyren/workspace'
const stackEnv = {
  ...env,
  DISPLAY,
  ZED_ALLOW_EMULATED_GPU: '1', // lavapipe: Zed refuses a software Vulkan adapter without this
  XDG_RUNTIME_DIR: process.env.RUNTIME_DIRECTORY ?? '/run/oyren-zed',
}
delete stackEnv.WAYLAND_DISPLAY // force the X11 backend — winit prefers Wayland when it is set

const children = []
let dying = false
function shutdown(code, why) {
  if (dying) return
  dying = true
  console.error(why)
  for (const c of children) { try { c.kill('SIGTERM') } catch { /* already gone */ } }
  process.exit(code)
}

function supervise(name, cmd, args) {
  const child = spawn(cmd, args, { stdio: 'inherit', env: stackEnv })
  child.on('error', (e) => shutdown(1, `${name}: spawn failed: ${e.message}`))
  // ANY child death is fatal: exit 1 → Restart=on-failure relaunches the whole stack in order.
  // A VNC client disconnect is NOT a child death — Xvnc keeps running (the Max*Time=0 flags
  // below) — so a closing browser never reaches this handler. That is the never-react-to-
  // disconnect requirement, held structurally rather than by configuration alone.
  child.on('exit', (code, sig) => shutdown(1, `${name} exited (${sig ?? code})`))
  children.push(child)
  return child
}

// systemctl stop: the control group gets SIGTERM anyway; exit 0 so the stop is clean, not "failed".
process.on('SIGTERM', () => shutdown(0, 'SIGTERM — stopping zed stack'))

cleanStaleDisplay(DISPLAY) // a stale socket/lock from an uncleanly-dead Xvnc poisons the restart
supervise('xvnc', resolveXvncBin(), [
  DISPLAY,
  // Loopback + no auth is safe for the same reason the editor binds 3131 to loopback: the sandbox
  // router's session-token path (/_oyren/zed/<token>/, zedProxy.js) is the only gate.
  '-interface', '127.0.0.1', '-websocketPort', WS_PORT,
  '-SecurityTypes', 'None', '-disableBasicAuth',
  // KasmVNC's documented defaults, pinned explicitly because they ARE the disconnect requirement:
  // 0 = never terminate on disconnect / idle / connection age. -AlwaysShared: a second tab or a
  // reconnect attaches to the same stream instead of bumping it.
  '-MaxDisconnectionTime', '0', '-MaxIdleTime', '0', '-MaxConnectionTime', '0', '-AlwaysShared',
  '-httpd', '/usr/share/kasmvnc/www',
  '-geometry', '1600x900', '-depth', '24', '-desktop', 'oyren-zed',
])
await waitForFile(`/tmp/.X11-unix/X${DISPLAY.slice(1)}`, 20_000) // X up before the WM connects

supervise('openbox', 'openbox', ['--config-file', '/etc/oyren/zed/rc.xml'])

// dbus-run-session owns a private session bus for exactly Zed's lifetime (keyring/portal lookups
// fail fast instead of hanging; agent credentials arrive via the session env, no keyring needed).
// --foreground keeps the CLI attached to the editor process, so THIS unit — not a detached fork —
// supervises Zed. /opt/zed/bin/zed directly (not the /usr/local/bin symlink): the CLI resolves
// ../libexec/zed-editor from its own path, and going through /opt/zed keeps that unambiguous.
supervise('zed', 'dbus-run-session', ['--', '/opt/zed/bin/zed', '--foreground', WORKSPACE_DIR])
console.log(`zed stack up: KasmVNC on 127.0.0.1:${WS_PORT}, display ${DISPLAY}, folder ${WORKSPACE_DIR}`)
