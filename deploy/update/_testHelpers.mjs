// Shared by the updater tests (not a test file itself: the runner's glob is *.test.mjs).
// Children are spawned ASYNC: the release server lives in the test process, and a blocking spawn
// would starve it of the event loop the child's curl is waiting on.
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const sha = (buf) => createHash("sha256").update(buf).digest("hex")

export const bash = (args, env) => new Promise((resolve) => {
  execFile("bash", args, { encoding: "utf8", env, timeout: 20_000, maxBuffer: 1 << 20 }, (error, stdout, stderr) =>
    resolve({ status: error ? (error.code ?? 1) : 0, stdout, stderr }))
})

export async function serve(files) {
  const server = createServer((req, res) => {
    const body = files[req.url]
    if (!body) { res.writeHead(404); return res.end() }
    res.writeHead(200); res.end(body)
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }
}

/** An installed image (claude 2.1.191, runtime t-old) plus a release that moves both. */
export function fixture() {
  const root = mkdtempSync(join(tmpdir(), "oyren-update-"))
  const installed = join(root, "image-manifest.json")
  writeFileSync(installed, JSON.stringify({ version: "2026-08-20-1410", family: "base", components: { claude: "2.1.191", runtime: "t-old", lean: null } }))
  mkdirSync(join(root, "composer/deploy"), { recursive: true })
  writeFileSync(join(root, "composer/deploy/versions.env"), "UPDATER_PROTOCOL=1\n")
  const tarball = Buffer.from("pretend-tarball")
  const manifest = (over = {}) => JSON.stringify({
    version: "2026-08-25-1838", family: "base", updaterProtocol: 1,
    components: { claude: "2.1.235", runtime: "t-new", lean: null },
    artifact: { name: "release.tar.gz", sha256: sha(tarball), bytes: tarball.length },
    ...over,
  })
  const env = {
    PATH: process.env.PATH, OYREN_IMAGE_MANIFEST: installed, OYREN_UPDATE_STATUS: join(root, "status.json"),
    OYREN_UPDATE_LOG: join(root, "update.log"), OYREN_SANDBOX_ENV: join(root, "no-sandbox.env"), COMPOSER_ROOT: join(root, "composer"),
  }
  return { root, installed, tarball, manifest, env }
}
