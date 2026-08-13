// The `route/*` control actions, split out of control.js. Same { status, payload } answer shape
// as controlRun.js, so handleControl stays a thin dispatcher.
const { publicOrigin } = require("./publicOrigin")

const notInit = () => ({ status: 501, payload: { error: "routes not initialized" } })

/** Handle one `route/*` action → { status, payload }, or null for an action we don't own. */
function routeAction(action, body, { routes, env = process.env } = {}) {
  if (action === "route/add") {
    if (!routes) return notInit()
    const prefix = body.prefix
    const port = Number(body.port)
    if (!prefix || !port) return { status: 400, payload: { error: "prefix and port are required" } }
    return { status: 200, payload: { routes: routes.add(prefix, port, body.label || "") } }
  }
  if (action === "route/remove") {
    if (!routes) return notInit()
    const prefix = body.prefix
    if (!prefix) return { status: 400, payload: { error: "prefix is required" } }
    const removed = routes.remove(prefix)
    return { status: removed ? 200 : 404, payload: { removed, routes: routes.list() } }
  }
  if (action === "route/list") {
    if (!routes) return notInit()
    // `origin` is the port proxy's capability probe: emitted ONLY when the public origin is
    // knowable AND SESSION_TOKEN is set (see publicOrigin.js). Its ABSENCE tells the consumer
    // that session-origin /_oyren/port URLs cannot be built for this sandbox.
    const origin = publicOrigin(env)
    return { status: 200, payload: { routes: routes.list(), ...(origin ? { origin } : {}) } }
  }
  return null
}

module.exports = { routeAction }
