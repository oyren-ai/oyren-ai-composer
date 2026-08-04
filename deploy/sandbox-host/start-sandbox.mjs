// systemd ExecStart for a session's sandbox runtime.
//
// The orchestrator delivers the session's environment as CONTAINER_ENV_B64 — base64 of a JSON
// object — inside cloud-init's /etc/oyren/sandbox.env. It stays base64 rather than becoming plain
// KEY=value lines because the values are not safe for that format: AGENT_META_B64 is JSON, the
// launch task is free text that can contain newlines, and callers may pass arbitrary env through.
// systemd's EnvironmentFile has no multi-line escape, so flattening would silently truncate them.
//
// Decoding here and exec'ing with a merged env keeps every value byte-exact, and keeps the secrets
// out of the process table (they are never argv).
import { spawn } from 'node:child_process'

const ENTRYPOINT = process.env.OYREN_ENTRYPOINT ?? '/app/entrypoint.sh'

function sessionEnv() {
  const b64 = process.env.CONTAINER_ENV_B64 ?? ''
  if (!b64) return {}
  const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('CONTAINER_ENV_B64 must decode to a JSON object')
  }
  return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]))
}

const env = { ...process.env, ...sessionEnv() }
// Don't hand the blob down: the entrypoint has the decoded vars, and anything spawned later
// (the agent, the user's shell) has no reason to see a second copy of every secret.
delete env.CONTAINER_ENV_B64

const child = spawn(ENTRYPOINT, { stdio: 'inherit', env })
child.on('error', (err) => {
  console.error(`failed to exec ${ENTRYPOINT}: ${err.message}`)
  process.exit(1)
})
// Mirror the child's fate so systemd's Restart=always sees the real outcome.
child.on('exit', (code, signal) => process.exit(signal ? 128 + 1 : (code ?? 1)))