const vscode = require("vscode");

/**
 * Log what this build actually exposes. Every line here answers a question that decides whether the
 * real integration is buildable at all, and each one is cheap — the expensive part is the bake, so
 * everything that could possibly be learned from one is learned from one.
 *
 * Written defensively on purpose: an absent API is a RESULT, not an error, and a thrown activation
 * would look identical to "the Chat view is hidden", which is a different problem with a different fix.
 */
function logCapabilities(out) {
  out.appendLine(`vscode.version=${vscode.version}`);

  // The @participant path.
  out.appendLine(`vscode.chat=${typeof vscode.chat}`);
  out.appendLine(`  chat.createChatParticipant=${typeof (vscode.chat && vscode.chat.createChatParticipant)}`);

  // The dropdown path: the chat input's picker is populated by language-model providers, not by
  // participants. Names differ across versions, so probe each rather than guess.
  const lm = vscode.lm;
  out.appendLine(`vscode.lm=${typeof lm}`);
  for (const fn of ["registerLanguageModelChatProvider", "registerChatModelProvider", "selectChatModels"]) {
    out.appendLine(`  lm.${fn}=${typeof (lm && lm[fn])}`);
  }

  // The decisive one. This build ships no Copilot extension (extensions/copilot is empty in
  // release/1.109), and product.json's defaultChatAgent is removed at bake time — so if the Chat
  // view still refuses to render, the gate is somewhere we haven't found yet.
  const ext = vscode.extensions;
  const copilot = ext && (ext.getExtension("GitHub.copilot") || ext.getExtension("GitHub.copilot-chat"));
  out.appendLine(`copilot installed=${copilot ? "YES — unexpected" : "no"}`);

  // Proposed APIs are what isDefault + modes need; if the launcher flag didn't take, registration
  // below fails and this is the line that explains why.
  const self = ext && ext.getExtension("oyren.oyren-chat-probe");
  const proposals = self && self.packageJSON && self.packageJSON.enabledApiProposals;
  out.appendLine(`enabledApiProposals=${proposals ? proposals.join(",") : "(none)"}`);

  // The real integration needs this to reach /agent/message on 127.0.0.1.
  out.appendLine(`SESSION_TOKEN=${process.env.SESSION_TOKEN ? "present" : "ABSENT"}`);
}

module.exports = { logCapabilities };
