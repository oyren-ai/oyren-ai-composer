// systemd ExecStart for the browser editor (oyren-editor.service).
//
// Runs as its OWN unit rather than being launched from entrypoint.sh, which is what the container
// did. On the VM the runtime unit has Restart=always with RestartSec=2, and systemd's default
// KillMode=control-group would take a backgrounded editor down with it — so every runtime crash
// would tear down and relaunch a ~400MB editor in a two-second loop. A separate unit, pulled in by
// Wants= (not PartOf=/BindsTo=), means a runtime restart leaves the editor alone.
//
// It also does NOT need to know $WORKDIR. entrypoint.sh only resolves that after cloning, which can
// take a while; the editor instead boots on /workspace immediately and the router 302s a bare hit
// on the base path to ?folder=$WORKDIR (see sandbox-runtime/src/ide.js).
import { spawn } from 'node:child_process'
import { mergedEnv } from './sessionEnv.mjs'

const BIN = process.env.OYREN_EDITOR_BIN ?? '/opt/openvscode-server/bin/openvscode-server'
const PORT = process.env.OYREN_EDITOR_PORT ?? '3131'

const env = mergedEnv()

// Kill switch. The smallest tiers are 1 vCPU / 1GB, shared with the agent; the editor is worth
// dropping there rather than thrashing swap.
if (env.OYREN_EDITOR === '0') {
  console.log('OYREN_EDITOR=0 — editor disabled for this session')
  process.exit(0)
}

// Fail closed. The session token is the ONLY thing gating the editor, and the editor is a
// root-capable IDE with an integrated terminal, the user's GitHub token and the agent's API keys.
// Without a token the router cannot authorise anyone, so refuse to start rather than run something
// unreachable-but-listening.
const token = env.SESSION_TOKEN
if (!token) {
  console.error('SESSION_TOKEN is not set — refusing to start the editor')
  process.exit(1)
}

const args = [
  '--host', '127.0.0.1', // never the droplet's public IP; :8080 already binds 0.0.0.0
  '--port', String(PORT),
  '--without-connection-token', // the router's path token is the gate
  '--disable-workspace-trust',
  '--server-base-path', `/_oyren/ide/${token}`,
  '--default-folder', '/workspace',
]

console.log(`starting editor on 127.0.0.1:${PORT} under /_oyren/ide/<token>`)
const child = spawn(BIN, args, { stdio: 'inherit', env })
child.on('error', (err) => {
  console.error(`failed to exec ${BIN}: ${err.message}`)
  process.exit(1)
})
child.on('exit', (code, signal) => process.exit(signal ? 128 + 1 : (code ?? 1)))