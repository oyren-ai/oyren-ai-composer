// Every save/restore of the session's tmux layout goes through here, never through tmux's own
// bindings: only this launcher knows the per-session state directory, refuses to save an EMPTY
// server (resurrect would re-point `last` at it), debounces the detach hook, synthesizes $TMUX for
// resurrect's headless runs, and puts the agent back into main:0.0 after a restore. Called by
// oyren-tmux.service (ExecStartPost restore), oyren-tmux-save.service (the timer and the
// pre-snapshot quiesce), tmux.conf's client-detached hook, and entrypoint.sh (remember).
import { mergedEnv } from './sessionEnv.mjs'
import { remember, restore, save, status } from './tmuxStateOps.mjs'

const [cmd, flag] = process.argv.slice(2)
const uid = process.getuid ? process.getuid() : 0
if (uid === 0) {
  // Root would look at /tmp/tmux-0, find nothing, and "succeed" while saving nobody's panes.
  console.error('[tmux-state] refusing to run as root: the session server belongs to the sandbox user')
  process.exit(1)
}

const env = mergedEnv()
const runs = {
  save: () => save(env, uid, { hook: flag === '--hook' }),
  restore: () => restore(env, uid, { force: flag === '--force' }),
  remember: () => remember(env),
  status: () => status(env, uid),
}
if (!runs[cmd]) {
  console.error('usage: tmux-state.mjs save [--hook] | restore [--force] | remember | status')
  process.exit(2)
}
// Exit 0 whatever happened inside: a failed save must never fail the unit or block a quiesce.
runs[cmd]().catch((e) => console.error(`[tmux-state] ${cmd} failed: ${(e && e.message) || e}`)).finally(() => process.exit(0))
