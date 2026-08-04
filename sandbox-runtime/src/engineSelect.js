// Engine selection for the agent chat HTTP surface: Claude Code keeps the battle-tested Agent SDK
// engine (agentEngine.js — untouched); every other AGENT_KIND speaks ACP through acpEngine.js. Both
// export the same interface (send/interrupt/listModels/setModel/state/replayTurn), so agentChat.js and
// agentControl.js consume whichever this resolves to. Decided once at require time — AGENT_KIND is
// fixed for the container's whole life.
const kind = process.env.AGENT_KIND || ""
module.exports = !kind || kind === "claude-code" ? require("./agentEngine") : require("./acpEngine")
