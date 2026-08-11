// Credential overlay for SIDE engines. The orchestrator resolves, per side-capable kind, the same
// credential the launch wizard would have used (saved subscription account → BYOK key → wallet) and
// ships them as AGENT_SIDE_AUTH_B64 = base64 JSON of kind → env map. The map is applied ONLY to the
// kind being spawned — flattened into the session env the per-kind contracts would collide (codex's
// native OPENAI_API_KEY vs qwen's OpenRouter-valued one) — and file-shaped creds (codex auth.json,
// gemini oauth_creds.json, opencode config) are seeded once, lazily, when that kind first spawns.
// Absent or malformed env ⇒ empty map ⇒ the engine greets with its sign-in link, as before.
const { seedAgentAuthForKind } = require("./seedAgentAuth")

let cache = null
const seeded = new Set()

function authMap(env) {
  if (cache) return cache
  try {
    cache = JSON.parse(Buffer.from(env.AGENT_SIDE_AUTH_B64 || "", "base64").toString("utf8") || "{}")
  } catch {
    cache = {}
  }
  return cache
}

/** The env a side engine of `kind` spawns with: the base env + that kind's credential overlay. */
function sideEnvForKind(kind, baseEnv = process.env) {
  const extra = authMap(baseEnv)[kind]
  return extra ? { ...baseEnv, ...extra } : { ...baseEnv }
}

/** Once per kind per boot: write the kind's file-shaped credentials. Failures stay silent — the
 *  engine then behaves exactly like an uncredentialed one (sign-in link). */
function seedSideAuth(kind, baseEnv = process.env) {
  if (seeded.has(kind)) return
  seeded.add(kind)
  const extra = authMap(baseEnv)[kind]
  if (!extra) return
  try { seedAgentAuthForKind(kind, { ...baseEnv, ...extra }) } catch {}
}

function __reset() { cache = null; seeded.clear() }

module.exports = { sideEnvForKind, seedSideAuth, __reset }
