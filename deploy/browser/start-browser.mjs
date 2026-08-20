// systemd ExecStart for the in-VM browser stack (oyren-browser.service): KasmVNC's X server +
// openbox + Chrome, one supervised process tree, streamed to the user's browser through the
// sandbox router (/_oyren/browser/<token>/ → 127.0.0.1:6091).
//
// WHY this exists: every agent-CLI login redirects to a LOOPBACK callback
// (http://localhost:1455/auth/callback for codex, an ephemeral port for claude). Neither CLI can
// point that callback anywhere else, and no provider would accept a non-loopback redirect (RFC 8252
// §7.3). Running the browser ON the droplet dissolves it — `localhost` there IS this machine, so
// the callback reaches the CLI that opened it. A Google/Gmail sign-in, a dev server on
// localhost:3000, and `oyren-open <url>` from any terminal all land in this same browser.
//
// Deliberately NOT a second copy of start-zed.mjs's shape by accident: it reuses zedStack.mjs
// (installed beside this file by install-zed.sh) for the X-server resolution and stale-display
// cleanup, because those problems are identical and were already solved once.
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mergedEnv } from './sessionEnv.mjs'
import { cleanStaleDisplay, resolveXvncBin, waitForFile } from './zedStack.mjs'

const env = mergedEnv()

// Fail closed, same reasoning as start-zed.mjs: the router's session token is the ONLY gate on the
// no-auth KasmVNC listener. Exit 0, not 1 — Restart=on-failure would loop a permanent
// misconfiguration; a stream nobody can reach should just stay down.
if (!env.SESSION_TOKEN) {
  console.error('SESSION_TOKEN is not set — refusing to start the browser stream')
  process.exit(0)
}

const DISPLAY = ':91' // X socket /tmp/.X11-unix/X91; port-mnemonic for the 6091 listener (zed owns :90/6090)
const WS_PORT = env.OYREN_BROWSER_PORT ?? '6091'
const HOME_DIR = env.HOME ?? '/home/oyren'
const PROFILE_DIR = env.OYREN_BROWSER_PROFILE ?? `${HOME_DIR}/.oyren-browser`
const START_URL = env.OYREN_BROWSER_START_URL ?? 'about:blank'

// Chrome comes from the image's Playwright install (/ms-playwright) rather than a second apt
// browser: it is already there for the playwright MCP, already has its shared-library deps
// installed by `playwright install-deps`, and it is a real Chrome build — which matters because
// Google sign-in is one of the flows this exists to serve.
function resolveChrome() {
  const explicit = env.OYREN_BROWSER_BIN
  if (explicit && existsSync(explicit)) return explicit
  const root = env.PLAYWRIGHT_BROWSERS_PATH ?? '/ms-playwright'
  // chromium-<build>/chrome-linux64/chrome — the build number moves with every playwright bump, so
  // glob rather than pin. Newest build wins (lexical sort is fine: the segment is a plain integer).
  const dirs = existsSync(root)
    ? readdirSync(root).filter((d) => d.startsWith('chromium-')).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
    : []
  for (const d of dirs) {
    for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = `${root}/${d}/${rel}`
      if (existsSync(p)) return p
    }
  }
  throw new Error(`no Chrome found under ${root} (set OYREN_BROWSER_BIN)`)
}

const stackEnv = {
  ...env,
  DISPLAY,
  XDG_RUNTIME_DIR: process.env.RUNTIME_DIRECTORY ?? '/run/oyren-browser',
}
delete stackEnv.WAYLAND_DISPLAY

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
  // A viewer disconnect is NOT a child death — Xvnc keeps running (Max*Time=0 below) — so closing
  // the tab never reaches this handler, and a half-finished login survives it.
  child.on('exit', (code, sig) => shutdown(1, `${name} exited (${sig ?? code})`))
  children.push(child)
  return child
}

process.on('SIGTERM', () => shutdown(0, 'SIGTERM — stopping browser stack'))

cleanStaleDisplay(DISPLAY)
supervise('xvnc', resolveXvncBin(), [
  DISPLAY,
  '-interface', '127.0.0.1', '-websocketPort', WS_PORT,
  '-SecurityTypes', 'None', '-disableBasicAuth',
  // 0 = never terminate on disconnect / idle / connection age; -AlwaysShared so a second tab
  // attaches to the same screen instead of bumping it. A login half-completed in this browser must
  // survive the user closing the tab.
  '-MaxDisconnectionTime', '0', '-MaxIdleTime', '0', '-MaxConnectionTime', '0', '-AlwaysShared',
  '-httpd', '/usr/share/kasmvnc/www',
  '-geometry', '1600x900', '-depth', '24', '-desktop', 'oyren-browser',
])
await waitForFile(`/tmp/.X11-unix/X${DISPLAY.slice(1)}`, 20_000)

supervise('openbox', 'openbox', ['--config-file', '/etc/oyren/zed/rc.xml'])

// --password-store=basic + --use-mock-keychain: there is no keyring on the droplet, and without
// these Chrome blocks on a Secret Service call that never answers.
// NO --no-sandbox: install-browser.sh installs the SUID chrome-sandbox helper beside the binary,
// so Chrome keeps its own sandbox even though the droplet's AppArmor forbids unprivileged user
// namespaces. A browser the user signs into Google with should not be the one running unsandboxed.
supervise('chrome', resolveChrome(), [
  `--user-data-dir=${PROFILE_DIR}`,
  '--no-first-run', '--no-default-browser-check',
  '--password-store=basic', '--use-mock-keychain',
  '--window-position=0,0', '--window-size=1600,900',
  START_URL,
])
console.log(`browser stack up: KasmVNC on 127.0.0.1:${WS_PORT}, display ${DISPLAY}, profile ${PROFILE_DIR}`)
