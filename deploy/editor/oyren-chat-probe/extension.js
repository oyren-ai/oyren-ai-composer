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
/** An output channel you can also read over SSH.
 *
 *  The channel alone was a mistake: it only exists inside a running workbench, so answering "did
 *  this work?" required a human with a browser looking at the right panel. The whole point of the
 *  probe is to settle a question cheaply, and a file makes it answerable from a shell. */
function makeSink(context) {
  const channel = vscode.window.createOutputChannel("Oyren Chat Probe");
  context.subscriptions.push(channel);
  const file = require("node:path").join(require("node:os").tmpdir(), "oyren-chat-probe.log");
  return {
    appendLine(line) {
      channel.appendLine(line);
      try {
        require("node:fs").appendFileSync(file, `${line}\n`);
      } catch {
        /* the channel is still the primary sink; a read-only tmp must not break the probe */
      }
    },
    file,
  };
}

function activate(context) {
  const out = makeSink(context);
  out.appendLine(`--- probe run at ${new Date().toISOString()} ---`);

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
      // Logged so "did the turn reach us?" is answerable from a shell. Without this, a request that
      // never arrives and one that arrives but renders nothing look identical from the outside —
      // and they have completely different fixes.
      out.appendLine(`HANDLER INVOKED: prompt=${JSON.stringify(request.prompt || "")}`);
      stream.markdown("**probe ok** — a third-party default participant owns this Chat view.\n\n");
      stream.markdown(`You said: \`${request.prompt || "(nothing)"}\``);
      out.appendLine("HANDLER COMPLETED");
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
