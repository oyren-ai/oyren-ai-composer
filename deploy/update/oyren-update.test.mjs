// The entry point's read-only verbs, and the component table every manifest key must appear in.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { bash, fixture, serve } from "./_testHelpers.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const ENTRY = join(HERE, "oyren-update.sh")
const COMPONENTS = join(HERE, "lib/components.sh")

test("--check names exactly what the release changes and exits 3; up to date exits 0", async () => {
  const f = fixture()
  const srv = await serve({ "/m.json": f.manifest(), "/same.json": readFileSync(f.installed) })
  try {
    const r = await bash([ENTRY, "--check", "--manifest-url", `${srv.base}/m.json`], f.env)
    assert.equal(r.status, 3, r.stderr)
    assert.equal(r.stdout, "claude 2.1.191 → 2.1.235\nruntime t-old → t-new\n")
    const same = await bash([ENTRY, "--check", "--manifest-url", `${srv.base}/same.json`], f.env)
    assert.equal(same.status, 0)
    assert.equal(same.stdout, "up to date\n")
    const json = await bash([ENTRY, "--check", "--json", "--manifest-url", `${srv.base}/m.json`], f.env)
    assert.equal(JSON.parse(json.stdout)[0].component, "claude")
  } finally { await srv.close() }
})

test("--status reads the status file, or says no update has run", async () => {
  const f = fixture()
  assert.match((await bash([ENTRY, "--status"], f.env)).stdout, /no update has run/)
  writeFileSync(f.env.OYREN_UPDATE_STATUS, JSON.stringify({ state: "done", step: "done", to: "2026-08-25-1838" }))
  assert.equal(JSON.parse((await bash([ENTRY, "--status"], f.env)).stdout).to, "2026-08-25-1838")
})

test("apply without URLs, or an unknown flag, is a usage error and touches nothing", async () => {
  const f = fixture()
  assert.equal((await bash([ENTRY], f.env)).status, 2)
  assert.equal((await bash([ENTRY, "--frobnicate"], f.env)).status, 2)
})

test("every manifest component has a live path and a restart rule in components.sh", async () => {
  const { COMPONENT_KEYS } = await import("../manifest/manifest.mjs")
  const all = [...new Set([...Object.values(COMPONENT_KEYS), "runtime", "host", "browser", "lean"])]
  const r = await bash(["-c", `source '${COMPONENTS}'; for c in ${all.join(" ")}; do echo "$c $(apply_kind "$c") [$(restart_for "$c")]"; done; echo "order: $COMPONENT_ORDER"`], { PATH: process.env.PATH })
  assert.equal(r.status, 0, r.stderr)
  for (const c of all) {
    assert.doesNotMatch(r.stdout, new RegExp(`^${c} unknown`, "m"), `${c} has no live path`)
    assert.match(r.stdout, new RegExp(`order: .*\\b${c}\\b`), `${c} missing from COMPONENT_ORDER`)
  }
  assert.match(r.stdout, /^runtime runtime \[oyren-sandbox\]$/m)
  assert.match(r.stdout, /^node refuse \[\]$/m)
  assert.match(r.stdout, /order: node .* runtime$/m, "host first, runtime last")
})
