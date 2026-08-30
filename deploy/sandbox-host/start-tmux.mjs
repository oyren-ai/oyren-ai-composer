// Env exporter for the session's tmux server (deploy/units/oyren-tmux.service, via
// run-tmux-server.sh).
//
// This script used to SPAWN the server itself, as `tmux -u -D start-server`. That argv is invalid
// in every tmux that has -D (tmux.c: `if ((flags & CLIENT_NOFORK) && argc != 0) usage();` since
// 3.2), so the unit usage-looped on every droplet from the day it shipped, and every web terminal
// quietly fell back to an ad-hoc server inside oyren-sandbox's cgroup. Nothing ever executed the
// argv in a test; startTmux.test.mjs now does, against a real tmux.
//
// Today the unit execs `tmux -u -D` itself, so the SERVER is the unit's main process and nothing
// node-shaped sits above it for a stray pkill or the OOM killer to take first. This script only
// prints the environment for that exec: the decoded session env (sessionEnv.mjs, CONTAINER_ENV_B64
// out of /etc/oyren/sandbox.env, never as argv) plus the Node heap default, as `export` lines the
// wrapper evals. Nothing is written to disk, so no secret ever lands in a file. Values are
// single-quoted with '\'' escapes, so multi-line launch tasks survive byte-exact; names bash cannot
// export are skipped rather than emitted as lines that would abort the whole eval.
import { mergedEnv, withNodeHeap } from './sessionEnv.mjs'

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const quote = (value) => `'${String(value).replaceAll("'", `'\\''`)}'`

if (process.argv[2] !== '--export-env') {
  console.error('start-tmux.mjs no longer starts the server: run with --export-env (the unit execs tmux -u -D itself)')
  process.exit(2)
}

const lines = Object.entries(withNodeHeap(mergedEnv()))
  .filter(([name]) => VALID_NAME.test(name))
  .map(([name, value]) => `export ${name}=${quote(value)}`)
process.stdout.write(`${lines.join('\n')}\n`)
