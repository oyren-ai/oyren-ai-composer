const vscode = require("vscode");

/**
 * STEP-1 probe for docs/oyren-chat-participant.md. Delete once the real participant ships.
 *
 * The one thing no amount of API documentation settles: whether Gitpod's openvscode-server build
 * actually ships the Chat UI (`vs/workbench/contrib/chat`) and loads `chatParticipants`. That is a
 * property of the build, so this answers it empirically — bake, launch, open the editor, look.
 *
 * Everything here is deliberately inert: no network, no `vscode.lm`, no model provider, no
 * `enabledApiProposals`. If `@probe` answers, the real extension's foundation is sound.
 */
function activate(context) {
  const out = vscode.window.createOutputChannel("Oyren Chat Probe");
  context.subscriptions.push(out);

  // Logged either way — an absent `vscode.chat` is itself the answer, and a silent failed
  // activation would look identical to "the view is hidden", which is a different problem.
  out.appendLine(`vscode.version=${vscode.version}`);
  out.appendLine(`vscode.chat=${typeof vscode.chat}`);
  out.appendLine(`createChatParticipant=${typeof (vscode.chat && vscode.chat.createChatParticipant)}`);
  // Also proves whether the extension host inherits the session env — the real participant needs
  // SESSION_TOKEN to call /agent/message, so learning this now saves a whole bake later.
  out.appendLine(`SESSION_TOKEN=${process.env.SESSION_TOKEN ? "present" : "ABSENT"}`);

  if (!vscode.chat || typeof vscode.chat.createChatParticipant !== "function") {
    out.appendLine("RESULT: chat API absent on this build — stop, do not build the participant.");
    return;
  }

  const participant = vscode.chat.createChatParticipant("oyren.probe", async (request, _ctx, stream) => {
    stream.markdown("**probe ok** — this build renders the Chat view and loads `chatParticipants`.\n\n");
    stream.markdown(`You said: \`${request.prompt || "(nothing)"}\``);
  });
  context.subscriptions.push(participant);
  out.appendLine("RESULT: participant registered.");
}

function deactivate() {}

module.exports = { activate, deactivate };
