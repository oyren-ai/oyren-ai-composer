// `oyren checkpoint`: one shadow-ref pass over every repo, on demand. The runtime already ticks
// every two minutes (gitCheckpoint.js); this is the same pass for the moments that cannot wait for
// a tick: the quiesce right before a snapshot, or a person about to do something brave.
const path = require("path")
const { checkpointOnce } = require("../gitCheckpoint")

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** One bounded pass; { results, timedOut }. Never throws past the race, never runs when disabled. */
async function boundedCheckpoint({ env = process.env, timeoutMs = 20_000, run = checkpointOnce } = {}) {
  if (env.OYREN_CHECKPOINT_DISABLED === "1") return { results: [], timedOut: false }
  let timedOut = false
  const results = await Promise.race([run({ env }), sleep(timeoutMs).then(() => { timedOut = true; return [] })])
  return { results, timedOut }
}

async function checkpointCommand(args, { stdout = (s) => process.stdout.write(s), env = process.env, run = checkpointOnce } = {}) {
  const t = args.indexOf("--timeout")
  const { results, timedOut } = await boundedCheckpoint({ env, run, timeoutMs: t >= 0 ? Number(args[t + 1]) * 1000 : 60_000 })
  const rows = results.map(({ dir, outcome }) => ({ repo: path.basename(dir), outcome }))
  if (args.includes("--json")) stdout(`${JSON.stringify({ results: rows, timedOut })}\n`)
  else if (!args.includes("--quiet")) {
    for (const { repo, outcome } of rows) stdout(`${repo}: ${outcome}\n`)
    if (timedOut) stdout("checkpoint: timed out; the two-minute tick will retry\n")
  }
  // no-remote and clean are facts, not failures; a *-failed outcome or a timeout is.
  return timedOut || rows.some(({ outcome }) => /-failed$/.test(outcome)) ? 1 : 0
}

module.exports = { boundedCheckpoint, checkpointCommand }
