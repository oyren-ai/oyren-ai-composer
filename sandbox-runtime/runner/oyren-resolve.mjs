// Resolve a repo's Oyren manifest into the commands app-runner should run.
// Manifests (priority order): oyren.ts, oyren.mts, oyren.js, oyren.mjs, oyren.yml, oyren.yaml.
// Run via tsx so TypeScript manifests import cleanly. Usage:
//   tsx oyren-resolve.mjs <dir> check                     → exit 0 if a manifest exists, else 2
//   tsx oyren-resolve.mjs <dir> install|build|start|port  → prints that value (empty if unset)
// `start` honors OYREN_MODE (dev → cfg.dev, else cfg.start), each falling back to the other.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { parse as parseYaml } from "yaml"

const dir = process.argv[2] || "."
const field = process.argv[3] || "check"

const NAMES = ["oyren.ts", "oyren.mts", "oyren.js", "oyren.mjs", "oyren.yml", "oyren.yaml"]
const manifest = NAMES.map((n) => join(dir, n)).find((p) => existsSync(p)) || null

async function load(file) {
  if (!file) return null
  if (/\.ya?ml$/.test(file)) return parseYaml(readFileSync(file, "utf8")) ?? {}
  const mod = await import(pathToFileURL(file).href)
  return mod.default ?? mod
}

const cfg = await load(manifest)

if (field === "check") process.exit(cfg ? 0 : 2)
if (!cfg) process.exit(2)

const mode = process.env.OYREN_MODE === "dev" ? "dev" : "prod"
const start = mode === "dev" ? cfg.dev || cfg.start : cfg.start || cfg.dev

const values = {
  install: cfg.install || "",
  build: cfg.build || "",
  start: start || "",
  port: String(cfg.port || process.env.PORT || 8080),
}

process.stdout.write(String(values[field] ?? ""))