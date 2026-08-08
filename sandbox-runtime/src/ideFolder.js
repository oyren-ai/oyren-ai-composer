// Which folder the browser editor is allowed to open.
//
// This is UX SHAPING, NOT A SECURITY BOUNDARY, and it is important not to confuse the two. The
// editor's own `/vscode-remote-resource?path=<absolute>` endpoint does no path validation, and its
// integrated terminal is a shell — so anything reachable by the `oyren` user stays reachable no
// matter what this file does. The real boundary is the one-droplet-per-session VM and the unix user,
// which is exactly where every comparable product (SageMaker, Cloud Shell, Gitpod, Coder) puts it.
//
// What this DOES buy: a session opens on its repo and stays there. Without it, one stray
// `?folder=/etc` — from a bookmark, a reload, or the editor restoring its last window — silently
// reopens the session somewhere the agent isn't working, and the user's next save lands in a
// directory nothing is tracking.
const path = require("path")

/** Legacy alias for the workspace root; /workspace is a symlink to the real directory, so a URL
 *  built from either spelling has to be accepted or a bookmark from an older session breaks. */
const WORKSPACE_ALIAS = "/workspace"

/** Absolute, normalised, no trailing slash — so string prefixing below can't be fooled by `..`. */
function normalize(p) {
  if (typeof p !== "string" || p.length === 0) return null
  const abs = path.posix.normalize(p.startsWith("/") ? p : `/${p}`)
  return abs.length > 1 ? abs.replace(/\/+$/, "") : abs
}

/**
 * Is `candidate` the workspace root or something inside it?
 *
 * The `/` on the prefix test is load-bearing: without it `/home/oyren/workspace-other` counts as
 * inside `/home/oyren/workspace`.
 */
function isWithin(candidate, root, workspaceDir) {
  const c = normalize(candidate)
  const r = normalize(root)
  if (!c || !r) return false
  const roots = [r]
  // Accept the alias spelling of the same place, both as the root itself and as a prefix.
  const ws = normalize(workspaceDir)
  if (ws && r.startsWith(`${ws}/`)) roots.push(`${WORKSPACE_ALIAS}${r.slice(ws.length)}`)
  else if (ws && r === ws) roots.push(WORKSPACE_ALIAS)
  return roots.some((base) => c === base || c.startsWith(`${base}/`))
}

/**
 * The folder this request should end up on, or null to leave the request alone.
 *
 * Returns the workdir when the request names somewhere outside it, or asks for an empty window
 * (`ew=true`) — an empty window has no folder at all, which is how a session ends up with the user
 * browsing the filesystem instead of their project.
 *
 * Terminates: the value returned is always inside the workdir, so the redirected request satisfies
 * the check and is passed through.
 */
function pinnedFolder(params, workdir, workspaceDir) {
  if (!workdir) return null
  if (params.get("ew") === "true") return workdir

  const named = params.get("folder") ?? params.get("workspace")
  if (named === null) return params.has("payload") ? null : workdir
  return isWithin(named, workdir, workspaceDir) ? null : workdir
}

module.exports = { pinnedFolder, isWithin }
