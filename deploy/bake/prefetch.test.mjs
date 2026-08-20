// Tests for the bake's download cache (deploy/bake/prefetch.sh).
//
// The cache moves the bake's big serial downloads into the dead time at the start of provisioning.
// What must hold for that to be safe rather than merely fast: a truncated download can never be
// picked up later as a complete artifact, a MISS quietly falls back to downloading rather than
// failing, and the URLs come from the installers' own pins so no second copy can drift. All three
// are exercised here over file:// URLs, so the tests need no network.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, "prefetch.sh")

const scratch = () => mkdtempSync(join(tmpdir(), "bake-prefetch-"))

/** Run `body` with prefetch.sh sourced against a fresh cache dir; returns the result + that dir. */
function run(body, cacheDir = scratch()) {
  const r = spawnSync("bash", ["-c", `set -uo pipefail\n. '${SCRIPT}'\n${body}\n`], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, BAKE_CACHE_DIR: cacheDir },
  })
  return { ...r, cacheDir }
}

/** A gzipped tarball at <dir>/<name>.tar.gz containing one file, plus its file:// URL. */
function tarball(dir, name, content = "payload") {
  const src = join(dir, "src")
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, "marker.txt"), content)
  const out = join(dir, `${name}.tar.gz`)
  spawnSync("tar", ["-czf", out, "-C", src, "marker.txt"])
  return { path: out, url: `file://${out}` }
}

test("prefetch_into_cache stores the asset under its cache name", () => {
  const dir = scratch()
  writeFileSync(join(dir, "thing.bin"), "hello")
  const r = run(`prefetch_into_cache thing.bin 'file://${join(dir, "thing.bin")}'`)
  assert.equal(r.status, 0)
  assert.equal(readFileSync(join(r.cacheDir, "thing.bin"), "utf8"), "hello")
})

test("a failed download leaves nothing behind that a later step could mistake for the asset", () => {
  const dir = scratch()
  const r = run(`prefetch_into_cache missing.bin 'file://${join(dir, "nope.bin")}' || echo "rc=$?"`)
  assert.match(r.stdout, /rc=/)
  // Neither the real name nor a stray .part file: a truncated fetch must not be reusable.
  assert.deepEqual(readdirSync(r.cacheDir).filter((f) => f.includes("missing")), [])
})

test("cached_curl uses the prefetched copy when there is one", () => {
  const dir = scratch()
  const cache = scratch()
  writeFileSync(join(cache, "asset.bin"), "from-cache")
  const r = run(`cached_curl asset.bin 'file://${join(dir, "does-not-exist")}' '${join(dir, "out.bin")}'`, cache)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /using prefetched/)
  assert.equal(readFileSync(join(dir, "out.bin"), "utf8"), "from-cache")
})

test("cached_curl falls back to downloading on a miss — a prefetch miss costs time, not the bake", () => {
  const dir = scratch()
  writeFileSync(join(dir, "asset.bin"), "from-origin")
  const r = run(`cached_curl asset.bin 'file://${join(dir, "asset.bin")}' '${join(dir, "out.bin")}'`)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /not prefetched/)
  assert.equal(readFileSync(join(dir, "out.bin"), "utf8"), "from-origin")
})

test("cached_curl still fails loudly when the origin is unreachable on a miss", () => {
  const dir = scratch()
  const r = run(`cached_curl asset.bin 'file://${join(dir, "nope")}' '${join(dir, "out.bin")}' || echo "rc=$?"`)
  assert.match(r.stdout, /rc=/)
})

test("cached_untar extracts from the cache and from the origin identically", () => {
  const dir = scratch()
  const { path, url } = tarball(dir, "stack")
  const cache = scratch()

  const miss = join(dir, "miss")
  mkdirSync(miss)
  const a = run(`cached_untar stack.tar.gz '${url}' '${miss}'`)
  assert.equal(a.status, 0)
  assert.equal(readFileSync(join(miss, "marker.txt"), "utf8"), "payload")

  spawnSync("cp", [path, join(cache, "stack.tar.gz")])
  const hit = join(dir, "hit")
  mkdirSync(hit)
  const b = run(`cached_untar stack.tar.gz 'file://${join(dir, "unreachable")}' '${hit}'`, cache)
  assert.equal(b.status, 0)
  assert.match(b.stdout, /using prefetched/)
  assert.equal(readFileSync(join(hit, "marker.txt"), "utf8"), "payload")
})

test("prefetch_assets fetches exactly what an installer's --print-assets declares", () => {
  const dir = scratch()
  writeFileSync(join(dir, "one.bin"), "1")
  writeFileSync(join(dir, "two.bin"), "2")
  const installer = join(dir, "install-fake.sh")
  writeFileSync(
    installer,
    `#!/usr/bin/env bash\nprintf '%s %s\\n' one.bin 'file://${join(dir, "one.bin")}' two.bin 'file://${join(dir, "two.bin")}'\n`,
  )
  chmodSync(installer, 0o755)

  const r = run(`prefetch_assets '${installer}'`)
  assert.equal(r.status, 0)
  assert.equal(readFileSync(join(r.cacheDir, "one.bin"), "utf8"), "1")
  assert.equal(readFileSync(join(r.cacheDir, "two.bin"), "utf8"), "2")
})

test("prefetch_assets skips an installer that is not present rather than failing the bake", () => {
  const r = run(`prefetch_assets /nonexistent/install.sh && echo ok`)
  assert.match(r.stdout, /skipping/)
  assert.match(r.stdout, /ok/)
})

test("an installer whose --print-assets contract broke warns instead of silently prefetching nothing", () => {
  const dir = scratch()
  const installer = join(dir, "install-broken.sh")
  // A renamed flag, or a `set -e` exit above the --print-assets branch, both look like this.
  writeFileSync(installer, "#!/usr/bin/env bash\nexit 0\n")
  chmodSync(installer, 0o755)
  const r = run(`prefetch_assets '${installer}' && echo not-fatal`)
  assert.match(r.stderr, /declared no assets/)
  assert.match(r.stdout, /not-fatal/)
})
