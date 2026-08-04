// Auto-answer the agent → client `session/request_permission` request — the ACP analog of the SDK
// engine's permissionMode: "bypassPermissions". A headless sandbox turn must never hang on a prompt,
// so pick the broadest allow option (allow_always > allow_once); when the agent offers no allow at
// all, select a reject option (so the turn keeps moving) or cancel as the last resort.
function choosePermissionOutcome(params) {
  const options = Array.isArray(params && params.options) ? params.options : []
  const byKind = (kind) => options.find((o) => o && o.kind === kind && o.optionId !== undefined)
  // Cursor ACP docs/examples use kebab optionIds (`allow-always`) without a `kind` field — accept those too.
  const byId = (id) => options.find((o) => o && o.optionId === id)
  const allow = byKind("allow_always") || byKind("allow_once") || byId("allow-always") || byId("allow-once")
  if (allow) return { outcome: { outcome: "selected", optionId: allow.optionId } }
  const reject = byKind("reject_once") || byKind("reject_always") || byId("reject-once") || byId("reject-always")
  if (reject) return { outcome: { outcome: "selected", optionId: reject.optionId } }
  return { outcome: { outcome: "cancelled" } }
}

module.exports = { choosePermissionOutcome }
