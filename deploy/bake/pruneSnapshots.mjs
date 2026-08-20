// Prune old DigitalOcean droplet snapshots baked by deploy/bake/*.
//
// WHY: every bake leaves a new image behind and nothing ever removes the old one, so the account
// accumulates ~10GB images at DO's per-GB monthly rate forever. Keeping a couple of generations per
// family is what you actually want: the current one, plus one to roll back to.
//
// WHAT IT WILL TOUCH: only snapshots named `oyren-sandbox-<family>-<timestamp>` (the names
// bake-base-snapshot.sh / derive-zed-snapshot.sh / derive-lean-snapshot.sh generate). Anything else
// in the account — hand-made snapshots, other projects, volume snapshots — is never a candidate.
//
// RUNNING IT: `DO_API_TOKEN=... node deploy/bake/pruneSnapshots.mjs --keep=2 --protect=<live ids>`
// prints the plan and exits; add --apply to delete. A `Prune snapshots` workflow_dispatch wrapper
// around this exact command belongs in .github/workflows (see the PR that added this file — the
// bot that opened it cannot push workflow files).
//
// SAFETY: the newest `keep` per family always survive, ids passed with --protect are never deleted
// (pass the ones the orchestrator is deployed with: DROPLET_SNAPSHOT_ID{,_ZED,_LEAN}), and nothing
// is deleted at all without --apply. A snapshot in use by a RUNNING droplet is not at risk either
// way — DO keeps the droplet's disk; the image is only needed to create new ones.

/** Families the bake scripts produce, matched on the name prefix they hardcode. */
export const FAMILIES = ["base", "zed", "lean"]

/** `oyren-sandbox-<family>-<anything>`; anything else is not ours and is never considered. */
export function familyOf(name) {
  const match = /^oyren-sandbox-(base|zed|lean)-/.exec(String(name || ""))
  return match ? match[1] : null
}

/**
 * Decide what to delete. Pure so the rules are testable without an API: given the account's
 * snapshots, returns one entry per family with what survives and what goes, newest first.
 *
 * `keep` counts SURVIVORS per family, not deletions, and is clamped to >= 1 — a run that would
 * empty a family is a mistake, never an instruction.
 */
export function planPrune(snapshots, { keep = 2, protectIds = [], families = FAMILIES } = {}) {
  const survivors = Math.max(1, Number(keep) || 0)
  const protectedSet = new Set(protectIds.map(String))
  return families.map((family) => {
    const mine = snapshots
      .filter((s) => familyOf(s.name) === family)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)))
    const kept = []
    const deleted = []
    for (const snapshot of mine) {
      if (kept.length < survivors) kept.push({ ...snapshot, reason: "newest" })
      else if (protectedSet.has(String(snapshot.id))) kept.push({ ...snapshot, reason: "protected" })
      else deleted.push(snapshot)
    }
    return { family, kept, deleted }
  })
}

/** Total GB the plan reclaims — what makes the dry run worth reading. */
export const reclaimedGb = (plan) =>
  Math.round(plan.flatMap((f) => f.deleted).reduce((sum, s) => sum + (Number(s.size_gigabytes) || 0), 0) * 10) / 10

// ---------------------------------------------------------------------------- CLI

const DO_API = "https://api.digitalocean.com/v2"

async function doApi(path, { token, method = "GET" }) {
  const res = await fetch(`${DO_API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  })
  if (res.status === 204) return null
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`DO ${method} ${path} → ${res.status} ${JSON.stringify(body).slice(0, 200)}`)
  return body
}

/** Every droplet snapshot in the account (paged — DO caps per_page at 200). */
async function listSnapshots(token) {
  const all = []
  for (let page = 1; page <= 20; page++) {
    const body = await doApi(`/snapshots?resource_type=droplet&per_page=200&page=${page}`, { token })
    const batch = body?.snapshots ?? []
    all.push(...batch)
    if (batch.length < 200) break
  }
  return all
}

const flag = (argv, name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const token = process.env.DO_API_TOKEN
  if (!token) {
    console.error("ERROR: DO_API_TOKEN is not set")
    process.exit(1)
  }
  const apply = argv.includes("--apply")
  const keep = Number(flag(argv, "keep", "2"))
  const protectIds = String(flag(argv, "protect", "")).split(",").map((s) => s.trim()).filter(Boolean)

  const plan = planPrune(await listSnapshots(token), { keep, protectIds })
  for (const { family, kept, deleted } of plan) {
    console.log(`\n${family}: keeping ${kept.length}, deleting ${deleted.length}`)
    for (const s of kept) console.log(`  keep   ${s.id}  ${s.created_at}  ${s.name}  (${s.reason})`)
    for (const s of deleted) console.log(`  DELETE ${s.id}  ${s.created_at}  ${s.name}`)
  }
  console.log(`\n${apply ? "deleting" : "would delete"} ${plan.flatMap((f) => f.deleted).length} snapshot(s), ~${reclaimedGb(plan)} GB`)
  if (!apply) {
    console.log("dry run — pass --apply to actually delete")
    process.exit(0)
  }
  for (const snapshot of plan.flatMap((f) => f.deleted)) {
    await doApi(`/snapshots/${snapshot.id}`, { token, method: "DELETE" })
    console.log(`deleted ${snapshot.id} ${snapshot.name}`)
  }
}
