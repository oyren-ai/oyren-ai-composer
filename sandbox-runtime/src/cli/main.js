// `oyren`: the in-terminal CLI the agent or a person runs. Deploy commands talk to the local control
// API (127.0.0.1:$PORT/_oyren/control/*) with CONTROL_TOKEN from the session env — the same surface
// the orchestrator drives, so both paths stay in sync. `update`, `version` and `quiesce` are the
// image's own lifecycle: what bake this machine runs, whether a newer one exists, applying it in
// place, and preparing the disk for a snapshot.
const { callControl, routeCommand } = require("./control")

const USAGE = `usage:
  oyren expose <port>                          route the public URL → your app
  oyren start [port]                           run via oyren manifest start command
  oyren restart                                restart the managed app
  oyren stop                                   stop the managed app
  oyren status                                 show app status
  oyren route add <prefix> <port> [label]      add a reverse proxy route
  oyren route remove <prefix>                  remove a route
  oyren route list                             list all configured routes
  oyren version [--json]                       which Oyren image this machine runs
  oyren update --check                         what a newer image would change (exit 3 = something)
  oyren update [--force <component>] [--no-wait] [--json]
                                               apply the newest image in place; shells survive
  oyren update --status                        follow the last update
  oyren quiesce [--json]                       stop the app and agent, trim the disk (before a snapshot)`

async function main(argv) {
  const [cmd, ...rest] = argv
  switch (cmd) {
    case "expose":
      if (!Number(rest[0])) { console.error("oyren expose: a numeric <port> is required, e.g. `oyren expose 3000`"); return 1 }
      return callControl("expose", { port: Number(rest[0]) })
    case "start":
      return callControl("start", rest[0] ? { port: Number(rest[0]) } : {})
    case "restart": case "stop": case "status":
      return callControl(cmd, {})
    case "route":
      return routeCommand(rest)
    case "version":
      return require("./version").versionCommand(rest)
    case "update":
      return require("./update").updateCommand(rest)
    case "quiesce":
      return require("./quiesce").quiesceCommand(rest)
    default:
      console.error(USAGE)
      return 1
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(typeof code === "number" ? code : 0),
  (e) => { console.error(`oyren: ${e && e.message ? e.message : e}`); process.exit(1) },
)
