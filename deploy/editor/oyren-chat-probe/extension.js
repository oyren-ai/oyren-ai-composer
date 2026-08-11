const vscode = require("vscode");
const { logCapabilities } = require("./probeCapabilities");

/**
 * Spike for docs/oyren-chat-participant.md. Delete once the real integration ships.
 *
 * The question it settles is not whether the chat API exists — it does — but whether a build with
 * NO Copilot in it will render the Chat view for a third-party participant that declares itself the
 * default. Nobody appears to have published such a build, so the only way to know is to bake one
 * and look. If the input box and the model picker appear and this answers, the real integration is
 * a normal extension. If the welcome pane refuses to yield, the fallback is our own sidebar view.
 *
 * Everything is wrapped: a failure must be LOGGED, never thrown, or it becomes indistinguishable
 * from the view simply being absent.
 */
function activate(context) {
  const out = vscode.window.createOutputChannel("Oyren Chat Probe");
  context.subscriptions.push(out);

  try {
    logCapabilities(out);
  } catch (err) {
    out.appendLine(`capability probe threw: ${err && err.message}`);
  }

  if (!vscode.chat || typeof vscode.chat.createChatParticipant !== "function") {
    out.appendLine("RESULT: no chat API on this build — the built-in view is not reachable. Use a sidebar view.");
    return;
  }

  try {
    const participant = vscode.chat.createChatParticipant("oyren.probe", async (request, _ctx, stream) => {
      stream.markdown("**probe ok** — a third-party default participant owns this Chat view.\n\n");
      stream.markdown(`You said: \`${request.prompt || "(nothing)"}\``);
    });
    context.subscriptions.push(participant);
    out.appendLine("RESULT: participant registered. Now LOOK: does the Chat view render an input box?");
  } catch (err) {
    // The likely failure is isDefault being rejected because the proposal flag didn't reach the
    // extension host — which the enabledApiProposals line above tells us.
    out.appendLine(`RESULT: registration FAILED: ${err && err.message}`);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
