// Publish translated stream-json lines the way the SDK engine does: mirror each into the
// loop-compat turn tracker (result lines close the turn) and onto the live broadcast.
const broadcast = require("../agentBroadcast")
const track = require("../agentTurnTrack")

const isResultLine = (line) => { try { return JSON.parse(line).type === "result" } catch { return false } }

function recordLines(lines) {
  for (const line of lines) { track.recordLine(line, isResultLine(line)); broadcast.record(line) }
}

module.exports = { recordLines }
