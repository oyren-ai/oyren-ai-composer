// Model lists for GET /agent/models on the ACP engine. Prefer what the session itself reported
// (ACP session/new may return { models: { availableModels, currentModelId } }); fall back to a static
// per-provider list so the endpoint NEVER 500s — even before the agent has spawned, or for a CLI that
// reports nothing. The static lists are best-effort defaults, not a source of truth.
const FALLBACKS = {
  "codex-cli": ["gpt-5.1-codex-max", "gpt-5.1-codex", "gpt-5.1-codex-mini"],
  "gemini-cli": ["gemini-3-pro-preview", "gemini-2.5-pro", "gemini-2.5-flash"],
  "qwen-code": ["qwen3-coder-plus", "qwen3-coder-flash"],
  "opencode": [],
  "cursor-cli": ["composer-2.5", "gpt-5.2", "claude-opus-4-8-thinking-high", "auto"],
  "antigravity-cli": ["gemini-3-pro", "claude-sonnet-4.5"],
}

const toEntry = (value, displayName) => ({ value, displayName: displayName || value })

/**
 * Normalise a session/new|load result into the `{ availableModels, currentModelId }` shape the rest of
 * the engine speaks. opencode doesn't report `models` at all — it advertises a generic
 * `configOptions: [{ id: "model", type: "select", currentValue, options: [{ value, name }] }]` — so
 * without this its model list arrives empty and the chat's model dropdown has nothing in it.
 * Returns null when the result carries neither shape (the caller then falls back to the static list).
 */
function normalizeSessionModels(result) {
  if (!result || typeof result !== "object") return null
  if (result.models) return result.models
  const options = Array.isArray(result.configOptions) ? result.configOptions : []
  const modelOption = options.find((o) => o && o.id === "model")
  if (!modelOption) return null
  const list = Array.isArray(modelOption.options) ? modelOption.options : []
  return { availableModels: list.map((o) => ({ modelId: o && o.value, name: o && o.name })), currentModelId: modelOption.currentValue || null }
}

/** Static default list for an agent kind ([] for unknown kinds — never throws). */
function fallbackModels(kind) {
  return (FALLBACKS[kind] || []).map((v) => toEntry(v))
}

/** Session-reported models when present (tolerant of shape drift), else the static fallback. */
function resolveModels(kind, sessionModels) {
  try {
    const list = sessionModels && Array.isArray(sessionModels.availableModels) ? sessionModels.availableModels : []
    const mapped = list.map((m) => toEntry(m && (m.modelId || m.id), m && m.name)).filter((m) => m.value)
    return mapped.length ? mapped : fallbackModels(kind)
  } catch {
    return fallbackModels(kind)
  }
}

/** The session's current model id when reported, else the caller's last-known value. */
function currentModel(sessionModels, fallback = null) {
  try {
    return (sessionModels && (sessionModels.currentModelId || sessionModels.current)) || fallback
  } catch {
    return fallback
  }
}

module.exports = { fallbackModels, resolveModels, currentModel, normalizeSessionModels }
