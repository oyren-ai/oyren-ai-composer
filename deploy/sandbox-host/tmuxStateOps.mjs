// The four tmux-state commands. Every path ends in exit 0 (the CLI enforces it): a failed save or
// restore must never fail the unit or the quiesce that invoked it, only say what happened.
import { existsSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureOptions, paneCount, pluginsDir, sessionKey, stateBase, stateDir, tmuxRunner, withLock } from './tmuxStateCore.mjs'

const script = (env, name) => join(pluginsDir(env), 'tmux-resurrect', 'scripts', name)
const say = (line) => console.log(`[tmux-state] ${line}`)
const touched = (dir) => { const p = join(dir, '.saved-at'); writeFileSync(p, ''); return p }
const ageMs = (path) => { try { return Date.now() - statSync(path).mtimeMs } catch { return Infinity } }

export async function save(env, uid, { hook = false } = {}) {
  const run = tmuxRunner(env, uid)
  if (!run.hasSocket()) return say('no server, nothing to save')
  const dir = await ensureOptions(run, env)
  const panes = await paneCount(run)
  // resurrect would re-point `last` at the empty layout (files_differ + ln -fs in save.sh); the
  // last GOOD save is exactly what a dead server needs, so an empty one is never recorded.
  if (panes === 0) return say('empty server, not saving')
  if (hook && ageMs(join(dir, '.saved-at')) < 30_000) return say('saved moments ago, hook debounced')
  const r = await withLock(dir, { waitMs: hook ? 0 : 20_000 }, () => run.bash(script(env, 'save.sh'), 20_000))
  if (!r.ok) return say(`save failed: ${r.err || r.out}`)
  touched(dir)
  say(`saved ${panes} pane(s) to ${dir}`)
}

/** The newest sibling key's `last`, for a CLONED droplet (OYREN_RESTORED=1) adopting the disk's
 *  previous session. A resume keeps its slug, so it never needs this. */
function adoptableDir(env) {
  try {
    const base = stateBase(env)
    const dirs = readdirSync(base)
      .map((name) => join(base, name))
      .filter((dir) => existsSync(join(dir, 'last')))
      .sort((a, b) => statSync(join(b, 'last')).mtimeMs - statSync(join(a, 'last')).mtimeMs)
    return dirs[0] || null
  } catch { return null }
}

export async function restore(env, uid, { force = false } = {}) {
  const run = tmuxRunner(env, uid)
  const dir = await ensureOptions(run, env)
  const done = await run.tmux(['show', '-gqv', '@oyren-restored'])
  if (done.out === '1' && !force) return say('already restored into this server')
  // Latch FIRST: a restore that crashes must not replay on the unit's next ExecStartPost.
  await run.tmux(['set', '-g', '@oyren-restored', '1'])
  let source = existsSync(join(dir, 'last')) ? dir : null
  if (!source && env.OYREN_RESTORED === '1') source = adoptableDir(env)
  if (!source) return say('fresh session, nothing to restore')
  if (source !== dir) await run.tmux(['set', '-g', '@resurrect-dir', source])
  const r = await withLock(dir, { waitMs: 20_000 }, () => run.bash(script(env, 'restore.sh'), 45_000))
  if (source !== dir) await run.tmux(['set', '-g', '@resurrect-dir', dir])
  if (!r.ok) return say(`restore failed: ${r.err || r.out}`)
  await reseedEnv(run, dir)
  await respawnAgent(run, env, dir)
  say(`restored from ${source}`)
}

/** What only entrypoint.sh can compute, re-seeded after a crash-restart it never saw. */
async function reseedEnv(run, dir) {
  for (const line of rememberedLines(dir)) {
    const eq = line.indexOf('=')
    if (eq > 0) await run.tmux(['set-environment', '-g', line.slice(0, eq), line.slice(eq + 1)])
  }
}
const rememberedLines = (dir) => { try { return readFileSync(join(dir, 'session-env'), 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const remembered = (dir, name) => rememberedLines(dir).find((l) => l.startsWith(`${name}=`))?.slice(name.length + 1) ?? null

/** An agent session's main:0.0 is the agent's pane by construction (entrypoint.sh); a restore
 *  brings it back as a bare shell with the transcript replayed, so put the agent back in it. */
async function respawnAgent(run, env, dir) {
  if (!env.AGENT_KIND) return
  const launch = env.OYREN_AGENT_LAUNCH || '/app/agent-launch.sh'
  const paneWd = await run.tmux(['display', '-p', '-t', 'main:0.0', '#{pane_current_path}'])
  const wd = remembered(dir, 'WORKING_DIR') || (paneWd.ok && paneWd.out) || env.WORKING_DIR || env.WORKDIR || '/workspace'
  const exists = await run.tmux(['has-session', '-t', '=main'])
  const r = exists.ok
    ? await run.tmux(['respawn-pane', '-k', '-t', 'main:0.0', '-c', wd, launch])
    : await run.tmux(['new-session', '-d', '-s', 'main', '-c', wd, launch])
  say(r.ok ? `agent back in main:0.0 (${wd})` : `agent respawn failed: ${r.err}`)
}

export function remember(env) {
  const dir = stateDir(env)
  const lines = ['WORKDIR', 'WORKING_DIR', 'NODE_OPTIONS'].filter((n) => env[n]).map((n) => `${n}=${env[n]}`)
  writeFileSync(join(dir, 'session-env'), `${lines.join('\n')}\n`, { mode: 0o600 })
  say(`remembered ${lines.length} value(s) for ${sessionKey(env)}`)
}

export async function status(env, uid) {
  const run = tmuxRunner(env, uid)
  const dir = stateDir(env)
  const last = join(dir, 'last')
  say(`key=${sessionKey(env)} dir=${dir}`)
  say(`last=${existsSync(last) ? new Date(statSync(last).mtimeMs).toISOString() : 'never'}`)
  say(`panes=${run.hasSocket() ? await paneCount(run) : 'no server'} restored=${(await run.tmux(['show', '-gqv', '@oyren-restored'])).out || '0'}`)
}
