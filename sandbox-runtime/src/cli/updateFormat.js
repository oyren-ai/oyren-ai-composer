// How `oyren update` and `oyren version` talk: pure formatting over the manifest, the diff and the
// status file, written for the person or agent reading a terminal, with a next step on failure.

/** The changed-components summary the updater prints (same wording as manifestCli.mjs). */
function formatDiff(diff) {
  if (!diff || !diff.length) return "up to date"
  return diff.map(({ component, from, to }) => `${component} ${from ?? "(none)"} → ${to ?? "(none)"}`).join("\n")
}

function formatVersion(manifest) {
  if (!manifest) return "This image predates version manifests (no /etc/oyren/image-manifest.json). A newer bake, restored or launched fresh, carries one."
  const lines = [`Oyren Codespace image ${manifest.family ?? "?"} ${manifest.version ?? "(unversioned)"}, built ${manifest.builtAt ?? "?"} from composer ${manifest.composerSha ?? "?"}`]
  for (const [name, value] of Object.entries(manifest.components || {})) lines.push(`  ${name.padEnd(16)} ${value ?? "(none)"}`)
  return lines.join("\n")
}

/** One line for where an update stands, from the status file. */
function formatStatus(status) {
  if (!status || status.state === "idle") return "no update has run on this machine"
  const arrow = status.from || status.to ? ` ${status.from ?? "?"} → ${status.to ?? "?"}` : ""
  if (status.state === "running") return `updating${arrow}: ${status.step ?? "…"}${status.unit ? ` (unit ${status.unit})` : ""}`
  if (status.state === "done") {
    const applied = Array.isArray(status.applied) && status.applied.length ? ` (${status.applied.join(", ")})` : ""
    return `updated to ${status.to ?? "?"}${applied}`
  }
  if (status.state === "failed") return `update${arrow} failed at ${status.step ?? "?"}: ${status.error ?? "unknown error"}`
  return `update state: ${status.state}`
}

/** What to do next after a failed run, from the step it failed at. */
function explainError(status) {
  const step = String((status && status.step) || "")
  if (step === "fetching") return "The download failed. Presigned links expire in minutes: run `oyren update` again to get fresh ones."
  if (step === "verifying") return "Nothing on this machine was changed. If it keeps failing, the published release is broken; tell the Oyren team which version."
  if (step.startsWith("applying:")) return `Everything applied before ${step.slice("applying:".length)} is in place. Read the log (${(status && status.log) || "/var/log/oyren-update.log"}), fix the cause (a tool you installed by hand shadowing a pinned one, a full disk), then run \`oyren update\` again: it resumes from where it stopped.`
  if (step === "restarting") return "The runtime was rolled back to the previous one, so this machine still works. Run `oyren update` again; if it rolls back twice, tell the Oyren team."
  return "Run `oyren update --status` for details, or `oyren update` to try again."
}

/** What survived and what did not, for the closing line of a successful update. */
function formatDone(status) {
  const applied = Array.isArray(status.applied) ? status.applied : []
  const parts = [`Updated to ${status.to ?? "?"}${applied.length ? ` (${applied.join(", ")})` : ""}.`]
  if (applied.includes("runtime") || applied.includes("host") || applied.includes("pnpm")) {
    parts.push("The runtime restarted: your tmux session and the agent in it survived; anything started with `oyren start` was stopped and needs `oyren start` again.")
  }
  if (applied.includes("editor")) parts.push("The editor restarted: reload its tab.")
  return parts.join(" ")
}

module.exports = { formatDiff, formatVersion, formatStatus, explainError, formatDone }
