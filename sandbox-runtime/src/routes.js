// Manages the proxy routes config file at <workdir>/.oyren-routes.json.
// LLMs and the `oyren` CLI can add/remove path→port mappings; the Node.js server proxies matching
// requests to the configured internal port. The file is watched for changes so an LLM editing it
// directly (without going through the CLI or API) takes effect immediately.
//
// Config format:
//   { "routes": [ { "prefix": "/studio", "port": 3000, "label": "Remotion Studio" }, … ] }
//
// Matching: longest prefix wins. A prefix of "/" matches everything (catch-all / default app).
// The matched prefix is stripped before forwarding (e.g. /studio/foo → /foo on port 3000).
const fs = require("fs")
const path = require("path")

const ROUTES_FILE = ".oyren-routes.json"

class Routes {
  constructor(workdir) {
    this.workdir = workdir
    this.filePath = path.join(workdir, ROUTES_FILE)
    this.routes = []
    this._load()
    this._watching = false
  }

  /** Start watching the config file for external edits (LLMs editing it directly). */
  watch() {
    if (this._watching) return
    this._watching = true
    fs.watchFile(this.filePath, { interval: 2000 }, () => this._load())
  }

  /** Stop the file watcher (for clean shutdown in tests). */
  unwatch() {
    if (!this._watching) return
    fs.unwatchFile(this.filePath)
    this._watching = false
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"))
      this.routes = Array.isArray(data.routes) ? data.routes.map(normalizeRoute).filter(Boolean) : []
    } catch {
      this.routes = []
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify({ routes: this.routes }, null, 2) + "\n")
  }

  /** Add or update a route. If a route with the same prefix exists, it is replaced. */
  add(prefix, port, label = "") {
    prefix = normalizePrefix(prefix)
    this.routes = this.routes.filter((r) => r.prefix !== prefix)
    this.routes.push({ prefix, port: Number(port), ...(label ? { label } : {}) })
    this._save()
    return this.routes
  }

  /** Remove a route by prefix. Returns true if a route was removed. */
  remove(prefix) {
    prefix = normalizePrefix(prefix)
    const before = this.routes.length
    this.routes = this.routes.filter((r) => r.prefix !== prefix)
    if (this.routes.length < before) { this._save(); return true }
    return false
  }

  /** Return a shallow copy of all routes. */
  list() {
    return [...this.routes]
  }

  /**
   * Find the best-matching route for a request path (longest prefix wins).
   * Returns { route, downstream } where downstream is the path to forward upstream
   * (prefix stripped), or null if no route matches.
   */
  match(requestPath) {
    const p = requestPath.split("?")[0] // strip query string for matching
    let best = null
    let bestLen = -1
    for (const route of this.routes) {
      if (route.prefix === "/") {
        // Catch-all — matches everything, but only wins if nothing longer matches
        if (bestLen < 1) { best = route; bestLen = 1 }
      } else if (p === route.prefix || p.startsWith(route.prefix + "/")) {
        if (route.prefix.length > bestLen) { best = route; bestLen = route.prefix.length }
      }
    }
    if (!best) return null
    // Strip the matched prefix to form the downstream path
    let downstream = requestPath
    if (best.prefix !== "/") {
      downstream = requestPath.slice(best.prefix.length) || "/"
    }
    return { route: best, downstream }
  }
}

/** Ensure prefix starts with / and has no trailing slash (unless it IS "/"). */
function normalizePrefix(prefix) {
  let p = String(prefix || "/").trim()
  if (!p.startsWith("/")) p = "/" + p
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1)
  return p
}

/** Validate + normalize a route object from the config file. Returns null for invalid entries. */
function normalizeRoute(r) {
  if (!r || typeof r !== "object") return null
  const port = Number(r.port)
  if (!port || port < 1 || port > 65535) return null
  return { prefix: normalizePrefix(r.prefix), port, ...(r.label ? { label: String(r.label) } : {}) }
}

module.exports = { Routes, normalizePrefix, normalizeRoute, ROUTES_FILE }
