// Tell the orchestrator what this bake promoted, so new Codespaces boot it.
//
// WHY: the orchestrator used to find the image to boot by scanning DigitalOcean for the newest
// `oyren-sandbox-<family>-<version>` name, and the release by reading `latest.json` out of the
// bucket. Neither remembers what was baked or from which commit, and neither has an off switch: a
// bad bake was latest the moment it was promoted. It now keeps a table, and this fills it in.
//
// RUNNING IT: `node deploy/bake/registerImage.mjs --family base --image-id 242661992 \
//   --version 2026-08-26-0900 --region fra1 --manifest out/manifest.base.json --targets dev,prod`.
// Each target reads its URL and token from the environment (ORCHESTRATOR_URL_DEV /
// IMAGE_REGISTRY_TOKEN_DEV and the _PROD pair), which in CI come from GitHub secrets — the token is
// never an argument and is never printed.
//
// IDEMPOTENT: 201 the first time, 200 on a re-run of the same image, 409 only if that version is
// already claimed by a DIFFERENT image id. Re-registering a promoted image is therefore always safe,
// which is what the workflow's `register_only` re-run relies on. Every target is tried before the
// run fails, so one orchestrator being down still records the image with the other.
import { readFileSync } from "node:fs"
import { buildBody, describe, sourceFrom, targetsFrom } from "./imageRegistry.mjs"

/** POST to one orchestrator. Never throws: the caller tries every target before failing the run. */
export async function registerWith(target, body, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`${target.url}/sandbox/images`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${target.token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
    const detail = await res.text().catch(() => "")
    return { name: target.name, ok: res.status === 200 || res.status === 201, status: res.status, created: res.status === 201, detail: detail.slice(0, 300) }
  } catch (e) {
    return { name: target.name, ok: false, status: 0, created: false, detail: String(e?.message ?? e) }
  }
}

const flag = (argv, name, fallback) => {
  const eq = argv.find((a) => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const at = argv.indexOf(`--${name}`)
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback
}

/** Read `out/manifest.<family>.json` for the tarball hash. Absent is fine: a re-registration has no
 *  build output on disk, and the orchestrator stores the hash as null. */
const readManifest = (path) => {
  if (!path) return null
  try { return JSON.parse(readFileSync(path, "utf8")) } catch { return null }
}

export async function runCli(argv, env = process.env, fetchImpl = globalThis.fetch, log = console.log) {
  const family = flag(argv, "family", "base")
  const body = buildBody({
    family,
    version: flag(argv, "version", env.RELEASE_VERSION ?? ""),
    imageId: flag(argv, "image-id", ""),
    region: flag(argv, "region", env.DO_REGION ?? "fra1"),
    composerSha: flag(argv, "composer-sha", env.COMPOSER_SHA ?? ""),
    manifest: readManifest(flag(argv, "manifest", "")),
    source: sourceFrom(env),
    published: !argv.includes("--no-release"),
  })
  const targets = targetsFrom(env, String(flag(argv, "targets", "dev,prod")).split(",").map((s) => s.trim()).filter(Boolean))
  log(`▶ registering ${body.doImageName} (image ${body.doImageId}) with ${targets.map((t) => t.name).join(", ")}`)
  const results = await Promise.all(targets.map((t) => registerWith(t, body, fetchImpl)))
  for (const result of results) log(describe(result))
  return results.every((r) => r.ok)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const passed = await runCli(process.argv.slice(2)).catch((e) => {
    console.error(`ERROR: ${e.message}`)
    return false
  })
  process.exit(passed ? 0 : 1)
}
