// The shape of an image registration, with no I/O in it: what the orchestrator's table expects, and
// which orchestrator to send it to. Kept pure so the rules are testable without a server; the POST
// and the CLI live in registerImage.mjs.

/** The orchestrator's key per bake family. An unknown family is a mistake, never a new key. */
export const IMAGE_KEYS = { base: "CODESPACE_BASE", lean: "CODESPACE_BASE_LEAN4_MATHLIB" }

const VERSION_RE = /^\d{4}-\d{2}-\d{2}-\d{4}$/

/** Where publish-release.sh puts a version's two objects. Keep these in step with that script. */
export const releaseKeys = (family, version) => ({
  manifestKey: `sandbox-releases/${family}/${version}/manifest.json`,
  tarballKey: `sandbox-releases/${family}/${version}/release.tar.gz`,
})

/**
 * The POST body. A run with `publish` off passes `published: false` and registers an image with no
 * release keys, which the orchestrator accepts and later reports as "no release for this version"
 * rather than presigning two objects that were never uploaded.
 */
export function buildBody({ family, version, imageId, region, composerSha, manifest, source, published = true }) {
  const key = IMAGE_KEYS[family]
  if (!key) throw new Error(`unknown family "${family}": expected ${Object.keys(IMAGE_KEYS).join(" or ")}`)
  if (!VERSION_RE.test(String(version))) throw new Error(`version must look like 2026-08-26-0900, got "${version}"`)
  if (!imageId) throw new Error("--image-id is required")
  return {
    key, version, doImageId: String(imageId), doImageName: `oyren-sandbox-${family}-${version}`, region,
    ...(composerSha ? { composerSha } : {}),
    ...(source ? { source } : {}),
    ...(published ? releaseKeys(family, version) : {}),
    ...(manifest?.artifact?.sha256 ? { tarballSha256: manifest.artifact.sha256 } : {}),
  }
}

/** Resolve `dev,prod` into URL + token pairs from the environment (GitHub secrets in CI). Missing
 *  config throws here, before anything is POSTed, so a misconfigured run fails loudly and early. */
export function targetsFrom(env, names) {
  return names.map((name) => {
    const suffix = name.toUpperCase()
    const url = env[`ORCHESTRATOR_URL_${suffix}`]
    const token = env[`IMAGE_REGISTRY_TOKEN_${suffix}`]
    if (!url) throw new Error(`ORCHESTRATOR_URL_${suffix} is not set`)
    if (!token) throw new Error(`IMAGE_REGISTRY_TOKEN_${suffix} is not set`)
    return { name, url: url.replace(/\/+$/, ""), token }
  })
}

/** The run-summary line for one target. */
export const describe = (result) =>
  result.ok
    ? `✅ ${result.name}: ${result.created ? "registered" : "already registered"} (${result.status})`
    : `❌ ${result.name}: ${result.status || "no reply"} ${result.detail}`

/** The GitHub run that produced the image, stored as the row's audit trail. */
export const sourceFrom = (env) =>
  env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : ""
