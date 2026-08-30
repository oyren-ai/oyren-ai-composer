// The ground truths every tmux-state command shares: which session key this droplet saves under,
// where the state lives, which socket the server is on, and a tmux runner that can work HEADLESS.
// resurrect's own scripts resolve the socket from $TMUX (they expect to run from a binding inside
// a client), so the runner synthesizes `TMUX=<socket>,0,0`; and @resurrect-dir is set here, per
// session, never in tmux.conf, so a resumed or cloned droplet can never save into another
// session's directory by accident.
import { existsSync, mkdirSync, rmdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'

export const sanitizeKey = (raw) => String(raw || '').replaceAll(/[^A-Za-z0-9._-]/gu, '-') || 'default'
/** Same precedence as checkpointRef.js: slug, then uuid, then a name that never collides with one. */
export const sessionKey = (env) => sanitizeKey(env.OYREN_SESSION_SLUG || env.OYREN_SESSION_UUID || 'default')
export const stateBase = (env) =>
  env.OYREN_TMUX_STATE_DIR || join(env.HOME || '/home/oyren', '.local/state/oyren/tmux-resurrect')
export const stateDir = (env) => join(stateBase(env), sessionKey(env))
export const pluginsDir = (env) => env.OYREN_TMUX_PLUGINS || '/usr/local/lib/oyren/tmux-plugins'
export const socketPath = (env, uid) => join(env.TMUX_TMPDIR || '/tmp', `tmux-${uid}`, 'default')

/** Build the runner for one invocation. Every call carries the synthesized $TMUX. */
export function tmuxRunner(env, uid) {
  const socket = socketPath(env, uid)
  const call = (bin, args, timeoutMs) =>
    new Promise((resolve) => {
      try {
        execFile(bin, args, { env: { ...env, TMUX: `${socket},0,0` }, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
          (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || '').trim() }))
      } catch (e) { resolve({ ok: false, out: '', err: String((e && e.message) || e) }) }
    })
  return {
    socket,
    hasSocket: () => existsSync(socket),
    tmux: (args, timeoutMs = 5_000) => call('tmux', args, timeoutMs),
    bash: (script, timeoutMs) => call('bash', [script, ...(script.endsWith('save.sh') ? ['quiet'] : [])], timeoutMs),
  }
}

/** Wait for the socket and the conf marker, source the conf into a pre-update server that lacks
 *  it, then point @resurrect-dir at this session's directory. Proceeds after the wait either way:
 *  a stuck server should get a loud failed save, not a silent skip. */
export async function ensureOptions(run, env, { waitMs = 10_000 } = {}) {
  const until = Date.now() + waitMs
  while (!run.hasSocket() && Date.now() < until) await new Promise((r) => setTimeout(r, 200))
  const marker = await run.tmux(['show', '-gqv', '@oyren-conf-loaded'])
  if (marker.ok && marker.out !== '1' && existsSync('/etc/tmux.conf')) await run.tmux(['source-file', '/etc/tmux.conf'])
  const dir = stateDir(env)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  await run.tmux(['set', '-g', '@resurrect-dir', dir])
  return dir
}

export const paneCount = async (run) => {
  const r = await run.tmux(['list-panes', '-a', '-F', 'x'])
  return r.ok && r.out ? r.out.split('\n').length : 0
}

/** A portable mkdir lock (flock does not exist on every dev machine). A holder older than 90 s is
 *  presumed dead and evicted, so one SIGKILLed save can never wedge every later one. */
export async function withLock(dir, { waitMs = 0 }, fn) {
  const lock = join(dir, '.lock')
  const until = Date.now() + waitMs
  for (;;) {
    try { mkdirSync(lock); break } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 90_000) { rmdirSync(lock); continue } } catch {}
      if (Date.now() >= until) return { ok: false, out: 'another save/restore holds the lock' }
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  try { return await fn() } finally { try { rmdirSync(lock) } catch {} }
}
