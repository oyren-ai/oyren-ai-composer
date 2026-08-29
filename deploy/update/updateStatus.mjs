// The in-place updater's status file (/etc/oyren/update-status.json) and its report to the
// orchestrator. One place writes it, atomically, so `oyren update --status`, the orchestrator's
// control poll and the updater's own restarts all read the same shape:
//   {state: running|done|failed, step, from, to, unit, changed[], applied[], startedAt, finishedAt, error, log}
// The droplet has node but no jq, which is why this is a node module the shell scripts call.
import { readFileSync, renameSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

export const DEFAULT_STATUS_FILE = "/etc/oyren/update-status.json"
export const STEPS = ["starting", "fetching", "verifying", "applying", "restarting", "done"]

export function readStatus(file = DEFAULT_STATUS_FILE) {
  try { return JSON.parse(readFileSync(file, "utf8")) } catch { return null }
}

/** Merge `patch` into the current status; state changes stamp startedAt/finishedAt. */
export function nextStatus(current, patch, now = new Date().toISOString()) {
  const base = current || {}
  const next = { ...base, ...patch }
  if (patch.state === "running" && !base.startedAt) next.startedAt = now
  if (patch.state === "running" && base.state !== "running") { next.startedAt = now; next.finishedAt = null; next.error = null }
  if (patch.state === "done" || patch.state === "failed") next.finishedAt = now
  if (patch.state === "done") next.error = null
  for (const key of ["changed", "applied"]) if (typeof next[key] === "string") next[key] = next[key] ? next[key].split(",") : []
  return next
}

export function writeStatus(file, patch, now) {
  const next = nextStatus(readStatus(file), patch, now)
  writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2) + "\n", { mode: 0o644 })
  renameSync(`${file}.tmp`, file)
  return next
}

/** The body /sandbox/update-result expects; null when the session env cannot reach an orchestrator. */
export function reportBody(status, env) {
  const { ORCHESTRATOR_URL, OYREN_SESSION_SLUG, CONTROL_TOKEN } = env
  if (!ORCHESTRATOR_URL || !OYREN_SESSION_SLUG || !CONTROL_TOKEN) return null
  return {
    url: `${ORCHESTRATOR_URL.replace(/\/$/, "")}/sandbox/update-result`,
    body: {
      appSlug: OYREN_SESSION_SLUG, controlToken: CONTROL_TOKEN,
      state: status.state, step: status.step ?? null, from: status.from ?? null, to: status.to ?? null, error: status.error ?? null,
    },
  }
}

/** Session env as the units see it: /etc/oyren/sandbox.env carries CONTAINER_ENV_B64 (JSON). */
export function sessionEnvFrom(text) {
  const line = String(text).split("\n").find((l) => l.startsWith("CONTAINER_ENV_B64="))
  if (!line) return {}
  try { return JSON.parse(Buffer.from(line.slice("CONTAINER_ENV_B64=".length).trim(), "base64").toString("utf8")) } catch { return {} }
}

export async function report(status, env, fetchImpl = globalThis.fetch) {
  const target = reportBody(status, env)
  if (!target) return false
  try {
    const res = await fetchImpl(target.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(target.body), signal: AbortSignal.timeout(8000) })
    return res.ok
  } catch { return false }
}

function flags(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1] ?? "", i++
  return out
}

export async function runCli(argv, { stdout = (s) => process.stdout.write(s), env = process.env, fetchImpl } = {}) {
  const [verb, ...rest] = argv
  const f = flags(rest)
  const file = f.file || env.OYREN_UPDATE_STATUS || DEFAULT_STATUS_FILE
  if (verb === "write") {
    const { file: _f, ...patch } = f
    stdout(JSON.stringify(writeStatus(file, patch)) + "\n")
    return 0
  }
  if (verb === "read") { const s = readStatus(file); stdout(s ? JSON.stringify(s, null, 2) + "\n" : ""); return s ? 0 : 1 }
  if (verb === "report") {
    const sessionEnv = f["sandbox-env"] ? sessionEnvFrom(readFileSync(f["sandbox-env"], "utf8")) : env
    const status = readStatus(file)
    if (!status) return 1
    return (await report(status, sessionEnv, fetchImpl)) ? 0 : 1
  }
  throw new Error("usage: updateStatus.mjs write|read|report …")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code), (e) => { process.stderr.write(`updateStatus: ${e.message}\n`); process.exit(2) })
}
