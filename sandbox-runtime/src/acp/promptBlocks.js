// Convert one send() payload — the frontend's Anthropic-style content-block array (images before
// text) or a bare prompt string (loops / curl) — into ACP `session/prompt` content blocks:
// { type:"text", text } stays, { type:"image", source:{ base64 } } becomes { type:"image", data,
// mimeType }. Anything unrecognized is dropped rather than crashing the turn.
function toPromptBlocks(payload) {
  if (!Array.isArray(payload)) return [{ type: "text", text: String(payload) }]
  const blocks = []
  for (const b of payload) {
    if (!b || typeof b !== "object") continue
    if (b.type === "text" && typeof b.text === "string") blocks.push({ type: "text", text: b.text })
    else if (b.type === "image" && b.source && b.source.type === "base64" && b.source.data)
      blocks.push({ type: "image", data: b.source.data, mimeType: b.source.media_type || "image/png" })
  }
  return blocks.length ? blocks : [{ type: "text", text: "" }]
}

module.exports = { toPromptBlocks }
