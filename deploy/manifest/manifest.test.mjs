// The manifest is the contract between a bake, the release it publishes and the updater on a live
// droplet. What matters is that the diff names exactly the components that changed and nothing
// else, and that a stamp never touches the image version.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildManifest, componentsFrom, diffManifests, parseVersionsEnv, partiallyUpdated, stampComponent, summarizeDiff,
} from "./manifest.mjs"

export const ENV = `# pins\nNODE_MAJOR=24\nCLAUDE_VERSION=2.1.235 # trailing comment\n\nOPENVSCODE_VERSION=1.109.5-oyren.3\nUPDATER_PROTOCOL=1\n`

test("parseVersionsEnv reads KEY=VALUE, skips comments and blanks, rejects junk", () => {
  assert.deepEqual(parseVersionsEnv(ENV), {
    NODE_MAJOR: "24", CLAUDE_VERSION: "2.1.235", OPENVSCODE_VERSION: "1.109.5-oyren.3", UPDATER_PROTOCOL: "1",
  })
  assert.throws(() => parseVersionsEnv("claude=1"), /expected KEY=VALUE/)
  assert.throws(() => parseVersionsEnv("JUSTAKEY"), /expected KEY=VALUE/)
})

test("componentsFrom maps pins to component names, adds hashes, and always carries lean", () => {
  const c = componentsFrom(parseVersionsEnv(ENV), { runtime: "t-abc", host: "t-def" })
  assert.deepEqual(c, { claude: "2.1.235", editor: "1.109.5-oyren.3", host: "t-def", lean: null, node: "24", runtime: "t-abc" })
  assert.equal(componentsFrom({}, {}, { lean: "leanprover/lean4:v4.22.0" }).lean, "leanprover/lean4:v4.22.0")
  assert.ok(!("UPDATER_PROTOCOL" in c), "non-component keys never leak into components")
})

test("buildManifest validates the version stamp and the family", () => {
  const m = buildManifest({ version: "2026-08-25-1838", family: "base", composerSha: "342436e", components: { runtime: "t-1" }, builtAt: "2026-08-25T18:38:00Z" })
  assert.equal(m.version, "2026-08-25-1838")
  assert.equal(m.updaterProtocol, 1)
  assert.deepEqual(m.components, { runtime: "t-1" })
  assert.throws(() => buildManifest({ version: "2026-8-25", family: "base" }), /version must look like/)
  assert.throws(() => buildManifest({ version: "2026-08-25-1838", family: "zed" }), /family must be one of/)
})

test("diffManifests names only what changed, including added and removed components", () => {
  const installed = { components: { claude: "2.1.191", runtime: "t-old", editor: "1.109.5-oyren.3", lean: null } }
  const target = { components: { claude: "2.1.235", runtime: "t-old", editor: "1.109.5-oyren.3", lean: null, dsh: "0.1.0-rc.7" } }
  assert.deepEqual(diffManifests(installed, target), [
    { component: "claude", from: "2.1.191", to: "2.1.235" },
    { component: "dsh", from: null, to: "0.1.0-rc.7" },
  ])
  assert.deepEqual(diffManifests(null, { components: { claude: "1" } }), [{ component: "claude", from: null, to: "1" }])
  assert.deepEqual(diffManifests(target, target), [])
})

test("summarizeDiff reads like a changelog line per component", () => {
  assert.equal(summarizeDiff([]), "up to date")
  assert.equal(
    summarizeDiff([{ component: "claude", from: "2.1.191", to: "2.1.235" }, { component: "lean", from: null, to: "v4" }]),
    "claude 2.1.191 → 2.1.235\nlean (none) → v4",
  )
})

test("stampComponent sets one component and leaves the version alone", () => {
  const before = { version: "2026-08-20-1410", family: "base", components: { claude: "2.1.191" } }
  const after = stampComponent(before, "claude", "2.1.235")
  assert.equal(after.version, "2026-08-20-1410")
  assert.equal(after.components.claude, "2.1.235")
  assert.equal(before.components.claude, "2.1.191", "input is not mutated")
  assert.equal(stampComponent(null, "lean", "null").components.lean, null)
  const target = { version: "2026-08-20-1410", components: { claude: "2.1.235" } }
  assert.equal(partiallyUpdated(after, target), false)
  assert.equal(partiallyUpdated(before, target), true)
})
