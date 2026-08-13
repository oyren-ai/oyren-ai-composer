// The browser IDE (openvscode-server) served under a reserved, token-bearing path.
//
// WHY A RESERVED PATH RATHER THAN "/": the old container wrote a "/" route at boot so the router
// proxied the root to the editor. That is unsafe here for three separate reasons:
//   1. Eviction — Routes.add() replaces any same-prefix route, and every format app's skill tells
//      the agent to run `oyren route add / <port>`. The editor would vanish mid-session.
//   2. Clone collision — the routes file lives at $WORKDIR/.oyren-routes.json, and entrypoint.sh
//      skips cloning when $WORKDIR already exists. Writing a route at boot would silently prevent
//      the repo from ever being cloned.
//   3. Durability — $WORKDIR is usually a git worktree, so `git clean -xfd` can delete the file.
// A reserved kind is matched before the Routes registry, so none of these can touch it, and "/"
// stays free for the user's app.
//
// WHY THE TOKEN IS IN THE PATH: openvscode generates every asset URL and the WebSocket URL from
// its --server-base-path, so a token embedded there rides on every request automatically. A query
// param would be dropped by those generated URLs, and a cookie would be a third-party cookie in
// our cross-site iframe — exactly what browser ITP rules block. This also matches the ?token=
// convention already used elsewhere: the browser cannot set headers on an iframe.

const IDE_PREFIX = "/_oyren/ide"
const IDE_PORT = Number(process.env.OYREN_EDITOR_PORT || 3131)

const { pinnedFolder } = require("./ideFolder")
const { tokenEq } = require("./sessionAuth")

function pathOf(rawUrl) {
  return (rawUrl || "/").split("?")[0]
}

/**
 * Constant-time check of the token segment in `/_oyren/ide/<token>/...`.
 * Fails closed when the sandbox has no SESSION_TOKEN — an editor with no gate is a root shell
 * open to anyone who can reach the host.
 */
function ideAuth(rawUrl, sessionToken) {
  if (!sessionToken) return false
  // ["", "_oyren", "ide", "<token>", ...]
  const got = pathOf(rawUrl).split("/")[3]
  if (typeof got !== "string" || got.length === 0) return false
  return tokenEq(decodeURIComponent(got), sessionToken)
}

/**
 * Where to send a hit on the IDE base path.
 *
 * Two jobs. First, supply the folder: the editor boots with `--default-folder` pointing at the
 * workspace root, because $WORKDIR is only known after entrypoint.sh has cloned the repo — which can
 * take a while, and the editor should be up before then. The router knows the resolved $WORKDIR, so
 * it fills it in here via openvscode's `?folder=` param.
 *
 * Second, keep it there. A request naming a folder outside $WORKDIR — or asking for an empty window
 * — is redirected back to $WORKDIR rather than passed through. See ideFolder.js for why that is
 * scoping and emphatically not a security boundary.
 *
 * Returns null (no redirect) when the request is not the bare base path, or is already pointing
 * somewhere acceptable. The redirect target always satisfies the check, so this cannot loop.
 */
function ideFolderRedirect(rawUrl, workdir, workspaceDir) {
  if (!workdir) return null
  const base = `${IDE_PREFIX}/`
  const path = pathOf(rawUrl)
  const rest = path.startsWith(base) ? path.slice(base.length) : null
  if (rest === null) return null
  // Only the token segment, with or without a trailing slash — i.e. the base path itself.
  if (rest.replace(/\/$/, "").includes("/")) return null

  const query = (rawUrl || "").split("?")[1] ?? ""
  const params = new URLSearchParams(query)
  const folder = pinnedFolder(params, workdir, workspaceDir)
  if (folder === null) return null

  params.delete("ew")
  params.delete("workspace")
  params.set("folder", folder)
  const token = rest.replace(/\/$/, "")
  return `${IDE_PREFIX}/${token}/?${params.toString()}`
}

module.exports = { IDE_PREFIX, IDE_PORT, ideAuth, ideFolderRedirect }
