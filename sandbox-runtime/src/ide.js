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

const crypto = require("crypto")

const IDE_PREFIX = "/_oyren/ide"
const IDE_PORT = Number(process.env.OYREN_EDITOR_PORT || 3131)

/** Query params openvscode itself uses to select what to open; if any is present the client has
 *  already been told where to go and must not be redirected again (that would loop). */
const FOLDER_PARAMS = ["folder", "workspace", "ew", "payload"]

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
  const a = Buffer.from(decodeURIComponent(got))
  const b = Buffer.from(sessionToken)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * Where to send a bare hit on the IDE base path.
 *
 * The editor is started at boot with `--default-folder /workspace`, because $WORKDIR is only known
 * after entrypoint.sh has cloned the repo — which can take a while, and we want the editor up
 * immediately. The router knows the resolved $WORKDIR, so it supplies the real folder here via
 * openvscode's `?folder=` param.
 *
 * Returns null (no redirect) unless the request is exactly the base path AND carries none of the
 * params openvscode uses to choose what to open — otherwise we would redirect the client onto a
 * URL that redirects again.
 */
function ideFolderRedirect(rawUrl, workdir) {
  if (!workdir) return null
  const base = `${IDE_PREFIX}/`
  const path = pathOf(rawUrl)
  const rest = path.startsWith(base) ? path.slice(base.length) : null
  if (rest === null) return null
  // Only the token segment, with or without a trailing slash — i.e. the base path itself.
  if (rest.replace(/\/$/, "").includes("/")) return null

  const query = (rawUrl || "").split("?")[1] ?? ""
  const params = new URLSearchParams(query)
  if (FOLDER_PARAMS.some((p) => params.has(p))) return null

  params.set("folder", workdir)
  const token = rest.replace(/\/$/, "")
  return `${IDE_PREFIX}/${token}/?${params.toString()}`
}

module.exports = { IDE_PREFIX, IDE_PORT, ideAuth, ideFolderRedirect }
