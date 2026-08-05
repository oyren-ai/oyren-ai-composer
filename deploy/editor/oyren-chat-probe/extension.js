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

  // The DROPDOWN question, which is a different API from the @participant one. Picking an agent
  // (opencode / cursor / codex / …) from the chat input's picker means contributing language-model
  // providers, not participants — so probe those entry points too rather than spending a second
  // bake to learn the name of a function.
  const lm = vscode.lm;
  out.appendLine(`vscode.lm=${typeof lm}`);
  for (const fn of ["registerLanguageModelChatProvider", "registerChatModelProvider", "selectChatModels"]) {
    out.appendLine(`  lm.${fn}=${typeof (lm && lm[fn])}`);
  }

  // Whether the Chat view is Copilot-gated is the decisive unknown: if the picker only appears when
  // Copilot is installed, none of this works for us (Copilot isn't on Open VSX, and we don't want
  // it). Record what the build thinks its default chat agent is.
  const ext = vscode.extensions;
  const copilot = ext && (ext.getExtension("GitHub.copilot") || ext.getExtension("GitHub.copilot-chat"));
  out.appendLine(`copilot installed=${copilot ? "YES" : "no"}`);

  // Also proves whether the extension host inherits the session env — the real integration needs
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
