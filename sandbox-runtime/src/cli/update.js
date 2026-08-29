// `oyren update`: bring this machine to the newest Oyren image in place. `--check` only says what
// would change. The apply goes through the root-side updater (/usr/local/bin/oyren-update, which
// re-launches itself in its own systemd unit) and this command follows its status file, so a
// person, an agent, and the orchestrator's button all run the same path.
const { execFile } = require("child_process")
const fs = require("fs")
const { fetchLatestRelease } = require("../releaseSource")
const { readImageManifest } = require("../imageManifest")
const { readUpdateStatus } = require("../controlUpdate")
const { explainError, formatDiff, formatDone, formatStatus } = require("./updateFormat")

const UPDATE_BIN = process.env.OYREN_UPDATE_BIN || "/usr/local/bin/oyren-update"
const LOG_FILE = process.env.OYREN_UPDATE_LOG || "/var/log/oyren-update.log"

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: "utf8", maxBuffer: 1 << 20 }, (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr }))
  })
}

function parseArgs(args) {
  const o = { check: false, status: false, wait: true, json: false, force: [], manifestUrl: "", tarballUrl: "" }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--check") o.check = true
    else if (a === "--status") o.status = true
    else if (a === "--no-wait") o.wait = false
    else if (a === "--json") o.json = true
    else if (a === "--yes" || a === "-y") { /* accepted for callers that expect a prompt; there is none */ }
    else if (a === "--force") o.force.push(args[++i])
    else if (a === "--manifest-url") o.manifestUrl = args[++i]
    else if (a === "--tarball-url") o.tarballUrl = args[++i]
    else throw new Error(`unknown option ${a}\nusage: oyren update [--check|--status] [--force <component>] [--no-wait] [--json]`)
  }
  return o
}

async function resolveRelease(o, deps) {
  if (o.manifestUrl && o.tarballUrl) return { version: "", manifestUrl: o.manifestUrl, tarballUrl: o.tarballUrl }
  const installed = readImageManifest()
  return fetchLatestRelease({ env: deps.env, fetchImpl: deps.fetchImpl, family: (installed && installed.family) || "" })
}

async function updateCommand(args, deps = {}) {
  const { stdout = (s) => process.stdout.write(s), exec = run, env = process.env, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), readStatus = readUpdateStatus } = deps
  const o = parseArgs(args)
  if (o.status) {
    const s = readStatus()
    stdout(o.json ? JSON.stringify(s) + "\n" : formatStatus(s) + (s && s.state === "failed" ? `\n${explainError(s)}` : "") + "\n")
    return s && s.state === "failed" ? 1 : 0
  }
  const release = await resolveRelease(o, { env, fetchImpl })
  if (o.check) {
    const r = await exec(UPDATE_BIN, ["--check", "--manifest-url", release.manifestUrl, ...(o.json ? ["--json"] : [])])
    stdout(r.stdout || r.stderr)
    return r.code
  }
  const check = await exec(UPDATE_BIN, ["--check", "--manifest-url", release.manifestUrl, "--json"])
  let diff = []
  try { diff = JSON.parse(check.stdout) } catch { /* the updater prints text on a download error; the apply below reports it properly */ }
  if (check.code === 0 && !o.force.length) { stdout(o.json ? JSON.stringify({ state: "idle", diff: [] }) + "\n" : "up to date\n"); return 0 }
  stdout(o.json ? "" : `applying ${release.version || "release"}:\n${formatDiff(diff)}\n`)
  const started = await exec("sudo", ["-n", UPDATE_BIN, "--manifest-url", release.manifestUrl, "--tarball-url", release.tarballUrl,
    ...(release.version ? ["--expect-version", release.version] : []), ...o.force.flatMap((c) => ["--force", c]), "--json"])
  if (started.code !== 0) { stdout(started.stderr || started.stdout); return started.code }
  if (!o.wait) { stdout(o.json ? started.stdout : `update started; follow it with: oyren update --status\n`); return 0 }
  return follow({ stdout, sleep, readStatus, json: o.json })
}

/** Print the log as it grows and stop when the status file says done or failed. */
async function follow({ stdout, sleep, readStatus, json }) {
  let offset = 0
  let lastStep = ""
  for (let i = 0; i < 20 * 60; i++) {
    try { const buf = fs.readFileSync(LOG_FILE, "utf8"); if (!json && buf.length > offset) { stdout(buf.slice(offset)); offset = buf.length } } catch { /* log appears once the unit starts */ }
    const s = readStatus()
    if (s && s.step && s.step !== lastStep && json) { stdout(JSON.stringify(s) + "\n"); lastStep = s.step }
    if (s && s.state === "done") { stdout(json ? "" : formatDone(s) + "\n"); return 0 }
    if (s && s.state === "failed") { stdout(json ? "" : `${formatStatus(s)}\n${explainError(s)}\n`); return 1 }
    await sleep(1000)
  }
  stdout("still running after 20 minutes; follow it with: oyren update --status\n")
  return 1
}

module.exports = { updateCommand, parseArgs }
