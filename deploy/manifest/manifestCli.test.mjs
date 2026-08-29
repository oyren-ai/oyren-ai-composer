// The CLI is what the shell scripts call: build at bake end, diff from `oyren update --check`
// (exit 3 means "there is something to update"), stamp from each installer.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs, runCli } from "./manifestCli.mjs"
import { ENV } from "./manifest.test.mjs"

test("parseArgs collects --hash name=value pairs and plain flags", () => {
  const { positional, flags } = parseArgs(["build", "--version", "2026-08-25-1838", "--hash", "runtime=t-1", "--hash", "host=t-2", "--json"])
  assert.deepEqual(positional, ["build"])
  assert.equal(flags.version, "2026-08-25-1838")
  assert.deepEqual(flags.hash, { runtime: "t-1", host: "t-2" })
  assert.equal(flags.json, true)
  assert.throws(() => parseArgs(["build", "--version"]), /missing value/)
})

test("the CLI builds, diffs (exit 3 on changes) and stamps a file on disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "manifest-"))
  const versions = join(dir, "versions.env")
  writeFileSync(versions, ENV)
  let out = ""
  const stdout = (s) => { out += s }
  const build = (v, extra = []) => {
    out = ""
    runCli(["build", "--version", v, "--family", "base", "--composer-sha", "abc", "--versions-file", versions, "--hash", "runtime=t-1", "--lean", "none", ...extra], { stdout })
    return JSON.parse(out)
  }
  const a = build("2026-08-20-1410")
  const b = build("2026-08-25-1838", ["--hash", "runtime=t-2"])
  writeFileSync(join(dir, "a.json"), JSON.stringify(a))
  writeFileSync(join(dir, "b.json"), JSON.stringify(b))
  out = ""
  assert.equal(runCli(["diff", join(dir, "a.json"), join(dir, "b.json")], { stdout }), 3)
  assert.equal(out, "runtime t-1 → t-2\n")
  out = ""
  assert.equal(runCli(["diff", join(dir, "a.json"), join(dir, "a.json")], { stdout }), 0)
  assert.equal(out, "up to date\n")
  assert.equal(runCli(["diff", join(dir, "missing.json"), join(dir, "a.json"), "--json"], { stdout }), 3, "no installed manifest = everything is new")
  assert.equal(runCli(["stamp", join(dir, "a.json"), "runtime", "t-2"], { stdout }), 0)
  assert.equal(JSON.parse(readFileSync(join(dir, "a.json"), "utf8")).components.runtime, "t-2")
  assert.equal(runCli(["stamp", join(dir, "fresh.json"), "claude", "2.1.235"], { stdout }), 0)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "fresh.json"), "utf8")), { version: null, family: null, components: { claude: "2.1.235" } })
  out = ""
  runCli(["summary", join(dir, "b.json")], { stdout })
  assert.match(out, /^base 2026-08-25-1838 built .* from composer abc\n  claude 2\.1\.235\n/)
  assert.throws(() => runCli(["frobnicate"]), /usage/)
})

test("build records the release artifact's sha256 and size when asked", () => {
  const dir = mkdtempSync(join(tmpdir(), "manifest-"))
  writeFileSync(join(dir, "versions.env"), ENV)
  writeFileSync(join(dir, "release.tar.gz"), "not really a tarball")
  let out = ""
  runCli(["build", "--version", "2026-08-25-1838", "--family", "lean", "--composer-sha", "abc", "--versions-file", join(dir, "versions.env"), "--lean", "leanprover/lean4:v4.22.0", "--artifact", join(dir, "release.tar.gz")], { stdout: (s) => { out += s } })
  const m = JSON.parse(out)
  assert.equal(m.family, "lean")
  assert.equal(m.components.lean, "leanprover/lean4:v4.22.0")
  assert.equal(m.artifact.name, "release.tar.gz")
  assert.equal(m.artifact.bytes, 20)
  assert.match(m.artifact.sha256, /^[0-9a-f]{64}$/)
})
