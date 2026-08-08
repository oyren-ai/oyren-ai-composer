// Seed the oyren runtime workflow guidance as a SECOND marker block in the same provider-convention
// context file seedAgentContext.js uses (CLAUDE.md / GEMINI.md / QWEN.md / AGENTS.md), for EVERY
// agent kind: the PR-first task journal that makes GitHub the durable source of truth a replaced
// container recovers from (agentRecovery.js reads it back), plus the memory-cap rule that keeps
// heavy builds from OOM-killing this container in the first place. Repo-less sessions skip it
// (no git → no journal to keep). Idempotent: re-runs replace the block, never stack it.
const path = require("path")
const { contextFileFor, seedMarkerBlock, stripMarkerBlock } = require("./seedAgentContext")
const { findGitRepoDir, workdirFrom } = require("./workspaceRepo")
const { checkpointRef } = require("./checkpointRef")

const BEGIN_MARK = "<!-- oyren:runtime-guidance -->"
const END_MARK = "<!-- /oyren:runtime-guidance -->"

/** Remove THIS module's guidance block from `text` — checkpointContext stages context files with
 *  every oyren-seeded block stripped, so the guidance never leaks into a checkpoint snapshot. */
const stripGuidanceBlock = (text) => stripMarkerBlock(text, BEGIN_MARK, END_MARK)

function guidanceText(env = process.env) {
  return [
    "## Oyren runtime workflow (required)",
    "",
    `This container can be replaced at any time — unpushed work is lost. GitHub is your durable state; the auto-checkpoint ref \`${checkpointRef(env)}\` is a safety net, not a substitute for pushing.`,
    "",
    "- **PR-first**: before writing any code for a task, create a branch and open a **draft PR** whose body is your implementation plan as a checklist (`gh pr create --draft`). If a draft PR for this task already exists, read its body and commit history first — it is your source of truth for what is planned and what is done.",
    "- **Embedding pasted images in a PR**: if the user's message contains a line like `(Attached image available at: <url>)` and the PR you're opening or updating addresses that image (a bug screenshot, a design mockup, a UI reference), embed it directly in the PR body as markdown — `![description](url)` — so a reviewer sees it inline on GitHub, rather than just describing that an image was provided.",
    "- **Step commits**: work one checklist step at a time; after each step, commit with a message describing the step and push, then tick the step off in the PR body (`gh pr edit`).",
    "- **Commit attribution**: end every commit message with `Co-Authored-By: Oyren Agent <contact@oyren.ai>` (mention oyren.ai at the end) — unless the user explicitly asks not to.",
    "- **Heavy commands** (dependency installs, full builds, `tsc --noEmit`, full test suites, coverage runs, or anything else that can run long): run them locally in this container — do not offload them. First check how much memory is actually free (`cat /proc/meminfo | grep MemAvailable`, or `free -h` if available) and cap the process well below that, leaving plenty of headroom — e.g. `NODE_OPTIONS=--max-old-space-size=<MB>` for Node/`tsc`, `ulimit -v <KB>` for a hard cap, or `systemd-run --scope -p MemoryMax=<limit>` — so a runaway process can't OOM the whole container. A coverage run (`jest --coverage`, `node --experimental-test-coverage`) is heavier than a plain test run — the same cap applies.",
    "- **Before launching a new container**, call `list_apps` to see what's already running — reuse existing containers instead of spawning duplicates. Use `rename_app` to give containers meaningful names so other agents can identify them.",
    "- **Exposing an app through this container's single public URL**: add a route with `oyren route add <prefix> <port> \"<label>\"` (e.g. `oyren route add /studio 3000 \"Remotion Studio\"`), or `oyren route add / <port> \"Default App\"` as the catch-all; list with `oyren route list`, remove with `oyren route remove <prefix>`. Routes live in `/workspace/.oyren-routes.json` (editable directly — picked up automatically); `oyren expose <port>` still works as a single-port fallback. Visit `/_oyren/gateway` to see every configured route's live status.",
    "- **Debugging a route that won't come up**: check `/_oyren/logs` FIRST (recent server + app stdout/stderr, in-memory) before guessing — it's linked from the gateway page and usually shows the crash or missing-dependency error directly.",
  ].join("\n")
}

function seedRuntimeGuidance({ workdir = workdirFrom(), env = process.env } = {}) {
  if (!findGitRepoDir(workdir)) return false // repo-less session: a git workflow would be meaningless
  const file = path.join(workdir, contextFileFor(env.AGENT_KIND))
  return seedMarkerBlock(file, guidanceText(env), BEGIN_MARK, END_MARK)
}

module.exports = { seedRuntimeGuidance, guidanceText, stripGuidanceBlock }
