---
name: lean-proving
description: Pair-prove Lean 4 theorems in /workspace/lean — check with lake env lean, edit the same files the user sees live in their browser editor. Use for any Lean 4 proof, tactic, or lake build task.
---

# Pair-proving in Lean 4

The user's browser editor (VS Code + Lean infoview) and you share `/workspace/lean` — your saved
edits appear in their editor within a second, theirs are what you read. Follow the loop in
`/workspace/lean/AGENTS.md`; the short version:

1. Read before editing (the user may have unsaved-context you're missing — ask if unsure).
2. One focused change (one `sorry`, one error), then verify:
   `cd /workspace/lean && lake env lean LeanProject/Basic.lean` — exit 0 = compiles.
3. Goal states: insert a `sorry` and read the reported goal, or use `#check`/`example` scratch
   declarations (remove them before finishing).
4. Never end a turn with the file broken — leave a commented `sorry` instead.
5. `lake build` after new files/imports; new modules go under `LeanProject/` and get imported
   from `LeanProject.lean`. Never delete `.lake/` or touch the toolchain.
6. Mathlib is preinstalled with warm oleans: `import Mathlib.Tactic` or any specific `Mathlib.*`
   module just works. Import specific modules, never the whole `Mathlib` umbrella (slow), and
   never run `lake update` (it can drift the pin and trigger an hours-long rebuild).