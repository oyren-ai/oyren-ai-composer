// The CLI's side of the local control API: one POST per command, printed as the server answered.
const http = require("http")

/** POST /_oyren/control/<action> on the local server. Resolves { status, body } (body = raw text). */
function requestControl(action, payload, { port = Number(process.env.PORT || 8080), token = process.env.CONTROL_TOKEN || "" } = {}) {
  const body = JSON.stringify(payload)
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1", port, method: "POST", path: `/_oyren/control/${action}`,
        headers: { "content-type": "application/json", "x-oyren-control-token": token, "content-length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = ""
        res.on("data", (d) => (data += d))
        res.on("end", () => resolve({ status: res.statusCode, body: data }))
      },
    )
    req.on("error", (e) => reject(new Error(`control server unreachable: ${e.message}`)))
    req.end(body)
  })
}

/** Run one control action for the CLI: print the answer, return the exit code. */
async function callControl(action, payload) {
  const { status, body } = await requestControl(action, payload)
  if (action === "route/list" && status < 300) printRouteTable(body)
  else console.log(body || "{}")
  return status >= 300 ? 1 : 0
}

function routeCommand([subCmd, ...subArgs]) {
  if (subCmd === "add") {
    const [prefix, portStr, ...labelParts] = subArgs
    const port = Number(portStr)
    if (!prefix || !port) {
      console.error("usage: oyren route add <prefix> <port> [label]")
      console.error('  e.g. oyren route add /studio 3000 "Remotion Studio"')
      return 1
    }
    return callControl("route/add", { prefix, port, label: labelParts.join(" ") })
  }
  if (subCmd === "remove" || subCmd === "rm") {
    if (!subArgs[0]) { console.error("usage: oyren route remove <prefix>"); return 1 }
    return callControl("route/remove", { prefix: subArgs[0] })
  }
  if (subCmd === "list" || subCmd === "ls" || !subCmd) return callControl("route/list", {})
  console.error("unknown route subcommand: " + subCmd)
  console.error("usage: oyren route {add|remove|list}")
  return 1
}

function printRouteTable(jsonStr) {
  try {
    const { routes } = JSON.parse(jsonStr)
    if (!routes || !routes.length) {
      console.log("No routes configured. Add one with: oyren route add <prefix> <port> [label]")
      return
    }
    console.log("PREFIX          PORT   LABEL")
    console.log("─".repeat(50))
    for (const r of routes) console.log(`${(r.prefix || "/").padEnd(16)}${String(r.port).padEnd(7)}${r.label || ""}`)
  } catch {
    console.log(jsonStr)
  }
}

module.exports = { requestControl, callControl, routeCommand, printRouteTable }
