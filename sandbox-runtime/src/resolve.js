// Thin adapter over app-runner's oyren-resolve.mjs: shells `tsx oyren-resolve.mjs <dir> <field>`
// to read install/build/start/port from the repo's manifest (oyren.ts/yml/...). The supervisor
// injects a fake of this module in tests, so it stays a minimal, un-unit-tested boundary.
const { execFile } = require("child_process")
const { RESOLVE_SCRIPT } = require("./config")

/** Print one resolved field ("install" | "build" | "start" | "port"); "" on any error. */
function resolveField(dir, field, mode) {
  return new Promise((resolve) => {
    const env = { ...process.env, OYREN_MODE: mode || process.env.OYREN_MODE || "prod" }
    execFile("tsx", [RESOLVE_SCRIPT, dir, field], { env }, (err, stdout) => {
      resolve(err ? "" : String(stdout).trim())
    })
  })
}

/** True if the repo has an Oyren manifest (oyren-resolve `check` exits 0). */
function hasManifest(dir) {
  return new Promise((resolve) => {
    execFile("tsx", [RESOLVE_SCRIPT, dir, "check"], (err) => resolve(!err))
  })
}

module.exports = { resolveField, hasManifest }
