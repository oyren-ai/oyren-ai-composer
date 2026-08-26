// The image manifest: what a bake stamps into /etc/oyren/image-manifest.json and what a live
// droplet diffs against the newest release to learn which components changed. Pure functions
// first; the CLI at the bottom (build / diff / stamp / summary) is what the shell scripts call,
// because the droplet has node but no jq.
import { createHash } from "node:crypto"
import { readFileSync, renameSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

export const VERSION_RE = /^\d{4}-\d{2}-\d{2}-\d{4}$/
export const FAMILIES = ["base", "lean"]

/** versions.env key → component name. Anything not listed here is not a component. */
export const COMPONENT_KEYS = {
  NODE_MAJOR: "node",
  PNPM_VERSION: "pnpm",
  CLAUDE_VERSION: "claude",
  CODEX_VERSION: "codex",
  CODEX_ACP_VERSION: "codexAcp",
  GEMINI_VERSION: "gemini",
  OPENCODE_VERSION: "opencode",
  QWEN_VERSION: "qwen",
  DSH_VERSION: "dsh",
  ANTIGRAVITY_ACP_VERSION: "antigravityAcp",
  PLAYWRIGHT_MCP_VERSION: "playwrightMcp",
  BUN_VERSION: "bun",
  OPENVSCODE_VERSION: "editor",
  KASMVNC_VERSION: "kasmvnc",
  ZED_VERSION: "zed",
}

/** Parse deploy/versions.env (KEY=VALUE, `#` comments). Throws on a malformed line. */
export function parseVersionsEnv(text) {
  const out = {}
  for (const raw of String(text).split("\n")) {
    const line = raw.replace(/#.*/, "").replace(/\s+/g, "")
    if (!line) continue
    const eq = line.indexOf("=")
    const key = eq > 0 ? line.slice(0, eq) : ""
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`versions.env: expected KEY=VALUE, got: ${raw.trim()}`)
    out[key] = line.slice(eq + 1)
  }
  return out
}

/** The components block: pinned versions from versions.env plus the hashed trees and lean. */
export function componentsFrom(versions, hashes = {}, { lean = null } = {}) {
  const components = {}
  for (const [key, name] of Object.entries(COMPONENT_KEYS)) {
    if (versions[key] !== undefined) components[name] = String(versions[key])
  }
  for (const [name, hash] of Object.entries(hashes)) components[name] = String(hash)
  components.lean = lean ? String(lean) : null
  return Object.fromEntries(Object.entries(components).sort(([a], [b]) => a.localeCompare(b)))
}

export function buildManifest({ version, family, builtAt, composerSha, components, updaterProtocol = 1, artifact = null }) {
  if (!VERSION_RE.test(String(version))) throw new Error(`manifest: version must look like 2026-08-25-1838, got: ${version}`)
  if (!FAMILIES.includes(family)) throw new Error(`manifest: family must be one of ${FAMILIES.join("|")}, got: ${family}`)
  return {
    version: String(version),
    family,
    builtAt: builtAt || new Date().toISOString(),
    composerSha: composerSha || "unknown",
    updaterProtocol: Number(updaterProtocol) || 1,
    components: components || {},
    ...(artifact ? { artifact } : {}),
  }
}

/** Components whose values differ, sorted by name. `from`/`to` are null when absent on that side. */
export function diffManifests(installed, target) {
  const a = (installed && installed.components) || {}
  const b = (target && target.components) || {}
  const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  return names
    .filter((n) => (a[n] ?? null) !== (b[n] ?? null))
    .map((component) => ({ component, from: a[component] ?? null, to: b[component] ?? null }))
}

/** "claude 2.1.191 → 2.1.235" per changed component; "up to date" when nothing changed. */
export function summarizeDiff(diff) {
  if (!diff.length) return "up to date"
  return diff.map(({ component, from, to }) => `${component} ${from ?? "(none)"} → ${to ?? "(none)"}`).join("\n")
}

/** A copy of `manifest` with one component set. `version` is untouched: a partial update keeps the
 *  old image version until every component matches the target (see apply-release.sh). */
export function stampComponent(manifest, component, value) {
  const base = manifest || { version: null, family: null, components: {} }
  return { ...base, components: { ...(base.components || {}), [component]: value === "null" ? null : value } }
}

/** True when some component differs from the manifest's own version, which the stamp keeps. */
export function partiallyUpdated(installed, target) {
  return Boolean(installed && target && installed.version === target.version && diffManifests(installed, target).length > 0)
}

export function artifactDescriptor(file, name = "release.tar.gz") {
  const bytes = readFileSync(file)
  return { name, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length }
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"))
const readJsonOrNull = (file) => { try { return readJson(file) } catch { return null } }
function writeJsonAtomic(file, value) {
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + "\n", { mode: 0o644 })
  renameSync(`${file}.tmp`, file)
}

/** argv → { positional[], flags{} }; `--hash name=value` accumulates into flags.hash. */
export function parseArgs(argv) {
  const positional = [], flags = { hash: {} }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("--")) { positional.push(arg); continue }
    const key = arg.slice(2)
    if (key === "json") { flags.json = true; continue }
    const value = argv[++i]
    if (value === undefined) throw new Error(`missing value for --${key}`)
    if (key === "hash") { const eq = value.indexOf("="); flags.hash[value.slice(0, eq)] = value.slice(eq + 1) }
    else flags[key] = value
  }
  return { positional, flags }
}

export function runCli(argv, { stdout = (s) => process.stdout.write(s) } = {}) {
  const { positional: [verb, ...rest], flags } = parseArgs(argv)
  if (verb === "build") {
    const versions = parseVersionsEnv(readFileSync(flags["versions-file"], "utf8"))
    const lean = flags.lean && flags.lean !== "none" ? flags.lean : null
    const artifact = flags.artifact ? artifactDescriptor(flags.artifact) : null
    const manifest = buildManifest({
      version: flags.version, family: flags.family, builtAt: flags["built-at"], composerSha: flags["composer-sha"],
      components: componentsFrom(versions, flags.hash, { lean }), updaterProtocol: versions.UPDATER_PROTOCOL, artifact,
    })
    stdout(JSON.stringify(manifest, null, 2) + "\n")
    return 0
  }
  if (verb === "diff") {
    const diff = diffManifests(readJsonOrNull(rest[0]), readJson(rest[1]))
    stdout(flags.json ? JSON.stringify(diff) + "\n" : summarizeDiff(diff) + "\n")
    return diff.length ? 3 : 0
  }
  if (verb === "stamp") {
    const [file, component, value] = rest
    if (!file || !component || value === undefined) throw new Error("usage: stamp <manifest.json> <component> <value>")
    writeJsonAtomic(file, stampComponent(readJsonOrNull(file), component, value))
    return 0
  }
  if (verb === "summary") {
    const m = readJson(rest[0])
    stdout(`${m.family ?? "?"} ${m.version ?? "?"} built ${m.builtAt ?? "?"} from composer ${m.composerSha ?? "?"}\n`)
    for (const [name, value] of Object.entries(m.components || {})) stdout(`  ${name} ${value ?? "(none)"}\n`)
    return 0
  }
  throw new Error("usage: manifest.mjs build|diff|stamp|summary …")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exit(runCli(process.argv.slice(2))) }
  catch (e) { process.stderr.write(`manifest: ${e.message}\n`); process.exit(2) }
}
