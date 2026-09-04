// The apply hand-over's final steps run AFTER the tree swap that moves $NEW_ROOT → $ROOT. They must
// keep working with the tree now living under $ROOT: the manifest version flips to the target and
// the status reaches "done". This is the regression for the bug where those post-swap paths still
// pointed at the moved-away $NEW_ROOT, so the version flip and "done" write silently no-op'd and the
// machine was left half-updated (new runtime, stale version, status stuck at "running").
import { test } from "node:test"
import assert from "node:assert/strict"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { bash } from "./_testHelpers.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..")

// A release that differs only by version (identical components): nothing installs, nothing
// restarts, so the whole exercise is the swap + the post-swap flip — the exact broken path.
const COMPONENTS = { claude: "2.1.235", runtime: "t-x", lean: null }

test("after the tree swap the manifest version flips and the status reaches done", async () => {
  const root = mkdtempSync(join(tmpdir(), "oyren-apply-"))
  const composer = join(root, "composer")       // ROOT (installed tree)
  const composerNew = join(root, "composer.new") // NEW_ROOT (release tree)

  const installed = join(root, "image-manifest.json")
  writeFileSync(installed, JSON.stringify({ version: "2026-08-20-1410", family: "base", components: COMPONENTS }))

  // The installed tree just has to exist for the swap; the release tree carries the real scripts.
  mkdirSync(composer, { recursive: true })
  mkdirSync(join(composerNew, "deploy"), { recursive: true })
  cpSync(join(REPO, "deploy", "update"), join(composerNew, "deploy", "update"), { recursive: true })
  cpSync(join(REPO, "deploy", "manifest"), join(composerNew, "deploy", "manifest"), { recursive: true })
  writeFileSync(join(composerNew, "deploy", "manifest", "target.json"),
    JSON.stringify({ version: "2026-08-25-1838", family: "base", updaterProtocol: 1, components: COMPONENTS }))

  const env = {
    PATH: process.env.PATH,
    OYREN_IMAGE_MANIFEST: installed,
    OYREN_UPDATE_STATUS: join(root, "status.json"),
    OYREN_UPDATE_LOG: join(root, "update.log"),
    OYREN_SANDBOX_ENV: join(root, "no-sandbox.env"),
    COMPOSER_ROOT: composer,
  }
  const r = await bash([join(composerNew, "deploy", "update", "apply-release.sh")], env)
  assert.equal(r.status, 0, r.stderr)

  const manifest = JSON.parse(readFileSync(installed, "utf8"))
  assert.equal(manifest.version, "2026-08-25-1838", "the image version must flip to the target")
  const status = JSON.parse(readFileSync(env.OYREN_UPDATE_STATUS, "utf8"))
  assert.equal(status.state, "done", "the status must reach done")
  assert.equal(status.step, "done")
  assert.ok(existsSync(join(composer, "deploy", "manifest", "target.json")), "release tree is installed at ROOT")
  assert.ok(existsSync(join(root, "composer.prev")), "previous tree is kept for rollback")
})
