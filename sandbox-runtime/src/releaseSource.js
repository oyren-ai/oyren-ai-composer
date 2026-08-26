// Where a live droplet learns about the newest bake: the orchestrator's POST /sandbox/release,
// authenticated the way /sandbox/git-token and /sandbox/agent-meta are (appSlug + controlToken in
// the body), answering the latest promoted release for this machine's family as presigned URLs.
// The droplet never holds a Spaces credential; the URLs expire in minutes, which is why the
// updater fetches right after asking.
const FETCH_TIMEOUT_MS = 10_000

class ReleaseError extends Error {
  constructor(message, code) { super(message); this.code = code }
}

/** Resolve the latest release for `family` (default: this image's). Throws a ReleaseError whose
 *  message says what to do next; never a bare HTTP status. */
async function fetchLatestRelease({ env = process.env, fetchImpl = globalThis.fetch, family = "", timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const { ORCHESTRATOR_URL, OYREN_SESSION_SLUG, CONTROL_TOKEN } = env
  if (!ORCHESTRATOR_URL || !OYREN_SESSION_SLUG || !CONTROL_TOKEN) {
    throw new ReleaseError("this Codespace has no orchestrator link (ORCHESTRATOR_URL / OYREN_SESSION_SLUG / CONTROL_TOKEN); pass --manifest-url and --tarball-url instead", "no-link")
  }
  let res
  try {
    res = await fetchImpl(`${ORCHESTRATOR_URL.replace(/\/$/, "")}/sandbox/release`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appSlug: OYREN_SESSION_SLUG, controlToken: CONTROL_TOKEN, ...(family ? { family } : {}) }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    throw new ReleaseError(`the orchestrator did not answer (${e && e.message ? e.message : e}); try again in a minute`, "unreachable")
  }
  if (res.status === 403) throw new ReleaseError("the orchestrator rejected this session's control token; a restart of the Codespace issues a fresh one", "forbidden")
  if (res.status === 404) throw new ReleaseError(`no release has been published for family '${family || "this image"}' yet`, "none")
  if (res.status === 429) throw new ReleaseError("too many release lookups from this session; wait a few minutes", "rate-limited")
  if (res.status === 501) throw new ReleaseError("this deployment does not publish releases (no releases bucket configured)", "unsupported")
  if (!res.ok) throw new ReleaseError(`release lookup failed (${res.status})`, "failed")
  const body = await res.json().catch(() => null)
  if (!body || !body.version || !body.manifestUrl || !body.tarballUrl) throw new ReleaseError("the orchestrator answered without a usable release", "malformed")
  return { version: String(body.version), family: body.family || family || null, manifestUrl: body.manifestUrl, tarballUrl: body.tarballUrl, expiresAt: body.expiresAt || null }
}

module.exports = { fetchLatestRelease, ReleaseError }
