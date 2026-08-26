// The shell-facing side of the image manifest: `build` (bake end, write-manifest.sh), `diff`
// (`oyren update --check`, exit 3 when something changed), `stamp` (each installer's last step)
// and `summary` (`oyren version`). Everything it computes lives in manifest.mjs.
import { createHash } from "node:crypto"
import { readFileSync, renameSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { buildManifest, componentsFrom, diffManifests, parseVersionsEnv, stampComponent, summarizeDiff } from "./manifest.mjs"

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
  throw new Error("usage: manifestCli.mjs build|diff|stamp|summary …")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exit(runCli(process.argv.slice(2))) }
  catch (e) { process.stderr.write(`manifest: ${e.message}\n`); process.exit(2) }
}
