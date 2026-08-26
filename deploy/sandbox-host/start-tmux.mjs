// systemd ExecStart for the session's tmux server (deploy/units/oyren-tmux.service).
//
// The server's environment is what every pane inherits, so it gets the same decoded session env
// the runtime gets (sessionEnv.mjs: CONTAINER_ENV_B64 out of /etc/oyren/sandbox.env, never as
// argv) plus the Node heap default entrypoint.sh applies to agent and build commands. The few
// values only entrypoint.sh can compute after cloning (WORKDIR, WORKING_DIR) reach the server
// through `tmux set-environment -g` from there.
//
// `-D` keeps the server in the foreground so systemd supervises the real process, and switches
// exit-empty off so a server whose last session closed stays up for the next attach.
import { spawn } from 'node:child_process'
import { mergedEnv, withNodeHeap } from './sessionEnv.mjs'

const env = withNodeHeap(mergedEnv())
const child = spawn('tmux', ['-u', '-D', 'start-server'], { stdio: 'inherit', env })
child.on('error', (err) => {
  console.error(`failed to start tmux: ${err.message}`)
  process.exit(1)
})
// A server that leaves is a failure to systemd (Restart=on-failure): the only legitimate way for
// it to end is `systemctl stop`, which kills the whole cgroup, this launcher included.
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1) || 1))
