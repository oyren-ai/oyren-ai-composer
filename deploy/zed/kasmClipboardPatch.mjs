// Turn OFF the KasmVNC web client's "clipboard did not change" short-circuit.
//
// THE BUG IT FIXES: with clipboard_seamless/up on, the client re-reads the browser clipboard on
// every user-driven focus event (`checkLocalClipboard` → `clipboardPasteFrom` for text,
// `clipboardPasteDataFrom` for the binary/image clipboard) and forwards it to the session's X
// CLIPBOARD. Both paths first hash the bytes and bail out — `logger.Debug("No clipboard changes")`
// — when the hash matches the last one they sent:
//
//     if (hash === this._clipHash) { logDebug("No clipboard changes"); return } else this._clipHash = hash
//
// That cache is a client-side guess about what the REMOTE clipboard holds, and it goes stale the
// moment anything else writes the X selection — a text paste synced up from the browser, our own
// `/_oyren/zed-clipboard` route (zedClipboard.js), or a copy inside Zed. Once it is stale the user
// is stuck: the clipboard still holds the SAME image, so its hash still matches, so the client
// never re-sends it and Ctrl+V in Zed keeps pasting whatever overwrote it. Copying something else
// and copying the image again is the only way out — the "cannot paste the same image again"
// report. Re-sending on focus costs one clipboard round trip and always lands the right bytes.
//
// HOW: replace the `<hash>===this._clipHash` guard with `false`, so the early return is dead while
// `this._clipHash = <hash>` still runs (the field stays truthful for anything else reading it).
// Minified identifiers change between builds; the `this._clipHash` field name is the stable part,
// so that is what the pattern anchors on. No match ⇒ the caller fails LOUDLY (upstream moved).

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** Stamped into every file we rewrite so a re-run is a no-op instead of a double patch. */
export const MARKER = "/*oyren:kasm-clipboard-dedupe-off*/"

/** `<minified ident>===this._clipHash` — the guard both clipboard paths share. */
const DEDUPE_GUARD = /[A-Za-z_$][A-Za-z0-9_$]*===this\._clipHash/g

/**
 * Rewrite one file's source. Returns the new source plus how many guards were neutered;
 * `alreadyPatched` is true (and `replacements` 0) when our marker is already present.
 */
export function patchClipboardDedupe(source) {
  if (source.includes(MARKER)) return { source, replacements: 0, alreadyPatched: true }
  let replacements = 0
  const patched = source.replace(DEDUPE_GUARD, () => {
    replacements += 1
    return "false"
  })
  if (replacements === 0) return { source, replacements: 0, alreadyPatched: false }
  return { source: patched + "\n" + MARKER + "\n", replacements, alreadyPatched: false }
}

/** Every `.js` under `dir`, recursively. */
export function jsFilesIn(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) jsFilesIn(path, out)
    else if (path.endsWith(".js")) out.push(path)
  }
  return out
}

/**
 * Patch the web client tree in place. Returns `{ files, replacements, alreadyPatched }` — the
 * caller (install-zed-stack.sh) treats "nothing patched and nothing already patched" as a bake
 * failure, because it means the upstream guard moved and the fix would ship silently missing.
 */
export function patchWwwTree(wwwDir, { write = writeFileSync, read = readFileSync, list = jsFilesIn } = {}) {
  const files = []
  let replacements = 0
  let alreadyPatched = 0
  for (const path of list(wwwDir)) {
    const result = patchClipboardDedupe(String(read(path, "utf8")))
    if (result.alreadyPatched) {
      alreadyPatched += 1
      continue
    }
    if (result.replacements === 0) continue
    write(path, result.source)
    files.push(path)
    replacements += result.replacements
  }
  return { files, replacements, alreadyPatched }
}

// CLI: `node kasmClipboardPatch.mjs [/usr/share/kasmvnc/www]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || "/usr/share/kasmvnc/www"
  const { files, replacements, alreadyPatched } = patchWwwTree(dir)
  if (replacements === 0 && alreadyPatched === 0) {
    console.error(
      `ERROR: no \`===this._clipHash\` clipboard guard found under ${dir} — the KasmVNC client changed, ` +
        `re-derive the patch before shipping this snapshot`,
    )
    process.exit(1)
  }
  console.log(
    replacements > 0
      ? `✅ clipboard dedupe disabled (${replacements} guard(s) in ${files.length} file(s)): ${files.join(", ")}`
      : `✅ clipboard dedupe already disabled (${alreadyPatched} file(s) carry the marker)`,
  )
}
