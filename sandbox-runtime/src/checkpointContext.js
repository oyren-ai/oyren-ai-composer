// Context-file-aware checkpoint staging. seedAgentContext / seedRuntimeGuidance write oyren marker
// blocks into the provider context file (CLAUDE.md / GEMINI.md / QWEN.md / AGENTS.md) at the repo
// root; those blocks must never leak into a checkpoint snapshot (they would land on the user's
// GitHub repo and keep `git status` permanently dirty) — but everything ELSE in those files is real
// user/agent content the safety net MUST protect. So instead of excluding the files wholesale, each
// candidate is staged with the marker blocks STRIPPED: dirty = the stripped content differs from
// HEAD (untracked: is non-empty after stripping), staged via `git hash-object -w --stdin` +
// `update-index` into the scratch index. An agent-authored AGENTS.md with no markers passes through
// verbatim, and nothing is ever anchored in .git/info/exclude — the agent's own `git add -A` always
// sees every one of its files.
const fs = require("fs")
const path = require("path")
const { stripMarkerBlock } = require("./seedAgentContext")
const { stripGuidanceBlock } = require("./seedRuntimeGuidance")

const SEEDED_CONTEXT_FILES = ["CLAUDE.md", "GEMINI.md", "QWEN.md", "AGENTS.md"]

/** Pathspecs appended to `git status` ONLY: context-file dirt is judged stripped-vs-HEAD by
 *  contextFileDirt, so the blanket status must skip them. NEVER pass these to `git add` — naming a
 *  gitignored file in an :(exclude) pathspec makes `git add` exit 1 ("path is ignored"), which would
 *  fail the whole snapshot for repos that gitignore CLAUDE.md/AGENTS.md (a common global-ignore). */
const excludePathspecs = () => SEEDED_CONTEXT_FILES.map((name) => `:(exclude)${name}`)

/** After the blanket `add -A` staged the worktree (context files INCLUDED, markers and all), restore
 *  every context entry in the scratch index to its HEAD baseline — tracked names back to the HEAD
 *  blob, untracked names dropped (`--force-remove` tolerates absent entries). stageContextDirt then
 *  overlays the STRIPPED blob for the really-dirty ones, so no marker ever leaks and no gitignored
 *  name is ever explicitly pathspec'd. False on any git failure (pass reports snapshot-failed). */
async function repairContextEntries(git, scratch, headSha) {
  for (const name of SEEDED_CONTEXT_FILES) {
    const at = await git(["ls-tree", headSha, "--", name])
    if (!at.ok) return false
    const entry = at.out.match(/^(\d{6}) blob ([0-9a-f]{40,64})\t/)
    const repair = entry
      ? ["update-index", "--add", "--cacheinfo", `${entry[1]},${entry[2]},${name}`]
      : ["update-index", "--force-remove", "--", name]
    if (!(await git(repair, scratch)).ok) return false
  }
  return true
}

/** `text` with BOTH oyren-seeded marker blocks removed (agent-context + runtime-guidance). */
const stripSeededBlocks = (text) => stripGuidanceBlock(stripMarkerBlock(text))

/** A context file's checkpoint-worthy content: marker blocks stripped, then trimmed so it compares
 *  cleanly with the exec's trimmed `git show` output (seeding only perturbs surrounding whitespace). */
const strippedContent = (file) => { try { return stripSeededBlocks(fs.readFileSync(file, "utf8")).trim() } catch { return "" } }

/** The context files that are REALLY dirty — stripped content ≠ HEAD, or non-empty when untracked:
 *  [{ name, content }] to stage, { name, remove: true } for a tracked file the agent deleted. */
async function contextFileDirt(repo, git) {
  const ls = await git(["ls-files", "--", ...SEEDED_CONTEXT_FILES])
  const tracked = new Set(ls.ok ? ls.out.split("\n").filter(Boolean) : [])
  const dirt = []
  for (const name of SEEDED_CONTEXT_FILES) {
    const exists = fs.existsSync(path.join(repo, name))
    if (!exists) { if (tracked.has(name)) dirt.push({ name, remove: true }); continue }
    const base = strippedContent(path.join(repo, name))
    if (!tracked.has(name)) { if (base) dirt.push({ name, content: `${base}\n` }); continue }
    const head = await git(["show", `HEAD:${name}`])
    if (!head.ok || head.out !== base) dirt.push({ name, content: base ? `${base}\n` : "" })
  }
  return dirt
}

/** Stage each dirty context file into the scratch index as its STRIPPED blob; false on any failure
 *  (the pass reports snapshot-failed rather than snapshotting a marker leak or losing the file). */
async function stageContextDirt(git, scratch, dirt) {
  for (const d of dirt) {
    if (d.remove) { if (!(await git(["update-index", "--force-remove", "--", d.name], scratch)).ok) return false; continue }
    const blob = await git(["hash-object", "-w", "--stdin"], scratch, d.content)
    if (!blob.ok || !blob.out) return false
    if (!(await git(["update-index", "--add", "--cacheinfo", `100644,${blob.out},${d.name}`], scratch)).ok) return false
  }
  return true
}

module.exports = { SEEDED_CONTEXT_FILES, excludePathspecs, stripSeededBlocks, contextFileDirt, stageContextDirt, repairContextEntries }
