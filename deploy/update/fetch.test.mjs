// The updater's safety lives before anything touches the disk: fetch must refuse a tarball the
// manifest does not describe, a version the caller did not ask for, or a protocol this machine
// does not understand — all without changing a byte. The apply hand-over goes through the test
// seam (OYREN_UPDATE_APPLY_CMD), never systemd.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { bash, fixture, serve, sha } from "./_testHelpers.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const FETCH = join(HERE, "lib/fetch.sh")
const STATUS = join(HERE, "lib/status.sh")

async function runFetch(f, job) {
  const jobFile = join(f.root, "job.env")
  writeFileSync(jobFile, Object.entries(job).map(([k, v]) => `${k}=${v}`).join("\n") + "\n")
  const seam = join(f.root, "apply-seam.sh")
  writeFileSync(seam, `#!/bin/sh\necho "APPLY $*" > "${f.root}/applied"\n`)
  chmodSync(seam, 0o755)
  const r = await bash(["-c", `source '${STATUS}'; source '${FETCH}'; fetch_release '${jobFile}'`], { ...f.env, OYREN_UPDATE_APPLY_CMD: seam })
  const state = JSON.parse(readFileSync(f.env.OYREN_UPDATE_STATUS, "utf8"))
  const applied = existsSync(join(f.root, "applied")) ? readFileSync(join(f.root, "applied"), "utf8") : null
  return { ...r, state, applied }
}

test("fetch verifies sha256, version and protocol before unpacking, and never leaves a half tree", async () => {
  const f = fixture()
  const srv = await serve({ "/m.json": f.manifest(), "/t.tgz": f.tarball, "/bad.tgz": Buffer.from("tampered"), "/v2.json": f.manifest({ updaterProtocol: 2 }) })
  try {
    const bad = await runFetch(f, { MANIFEST_URL: `${srv.base}/m.json`, TARBALL_URL: `${srv.base}/bad.tgz` })
    assert.equal(bad.state.state, "failed")
    assert.match(bad.state.error, /checksum mismatch/)
    assert.ok(!existsSync(join(f.root, "composer.new")), "nothing unpacked")
    const wrongVersion = await runFetch(f, { MANIFEST_URL: `${srv.base}/m.json`, TARBALL_URL: `${srv.base}/t.tgz`, EXPECT_VERSION: "2026-09-01-0000" })
    assert.match(wrongVersion.state.error, /not the expected/)
    const protocol = await runFetch(f, { MANIFEST_URL: `${srv.base}/v2.json`, TARBALL_URL: `${srv.base}/t.tgz` })
    assert.match(protocol.state.error, /updater protocol 2/)
    assert.equal(protocol.applied, null)
    const gone = await runFetch(f, { MANIFEST_URL: `${srv.base}/missing.json`, TARBALL_URL: `${srv.base}/t.tgz` })
    assert.match(gone.state.error, /could not download the release manifest/)
  } finally { await srv.close() }
})

test("a good release is unpacked beside the installed tree and the NEW tree's apply is exec'd", async () => {
  const f = fixture()
  const src = join(f.root, "src/composer/deploy/update")
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, "apply-release.sh"), "#!/bin/sh\necho applied\n")
  mkdirSync(join(f.root, "src/composer/deploy/manifest"), { recursive: true })
  spawnSync("tar", ["-czf", join(f.root, "release.tar.gz"), "-C", join(f.root, "src"), "composer"])
  const tarball = readFileSync(join(f.root, "release.tar.gz"))
  const manifest = f.manifest({ artifact: { name: "release.tar.gz", sha256: sha(tarball), bytes: tarball.length } })
  const srv = await serve({ "/m.json": manifest, "/t.tgz": tarball })
  try {
    const ok = await runFetch(f, { MANIFEST_URL: `${srv.base}/m.json`, TARBALL_URL: `${srv.base}/t.tgz`, EXPECT_VERSION: "2026-08-25-1838" })
    assert.equal(ok.status, 0, ok.stderr)
    assert.equal(ok.state.step, "verifying")
    assert.ok(existsSync(join(f.root, "composer.new/deploy/update/apply-release.sh")))
    assert.equal(JSON.parse(readFileSync(join(f.root, "composer.new/deploy/manifest/target.json"), "utf8")).version, "2026-08-25-1838")
    assert.match(ok.applied, /APPLY .*composer\.new\/deploy\/update\/apply-release\.sh --job/)
    assert.match(readFileSync(f.env.OYREN_UPDATE_LOG, "utf8"), /release 2026-08-25-1838 verified/)
  } finally { await srv.close() }
})
