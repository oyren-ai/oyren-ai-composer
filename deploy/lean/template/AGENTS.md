# Proving with Lean 4 (oyren sandbox)

You are in a ready-to-build Lean 4 project at `/home/oyren/workspace/lean`. The user sees these SAME files in
a browser VS Code with the Lean infoview — every edit you save shows up in their editor within a
second, and their saves are what you read. You are pair-proving, not working on a copy.

## What is already here
- `LeanProject/Basic.lean` — the working file; `LeanProject.lean` is the library root import.
- The toolchain in `lean-toolchain` is preinstalled via elan and the project is prebuilt
  (`.lake/` is warm). NEVER delete `.lake/` or reinstall the toolchain.
- Mathlib is a dependency with prebuilt oleans already unpacked — `import Mathlib.Tactic` (or any
  specific `Mathlib.*` module) works immediately. Import the specific modules you need, NOT the
  whole `Mathlib` umbrella (that makes every elaboration slow). Do not run `lake update` — it can
  drift the pin and force an hours-long rebuild.

## Cooperative proving loop
1. Read the file the user is working in before touching it — they may have local edits.
2. Make one focused change at a time (finish one `sorry`, fix one error), then CHECK it:
   ```bash
   cd /home/oyren/workspace/lean && lake env lean LeanProject/Basic.lean
   ```
   Exit 0 with no output = everything compiles. Errors show file:line:col — read them, fix, re-check.
3. `lake build` rebuilds the whole library (use after adding files or changing imports).
4. To inspect a goal state at a point, add a `sorry` there and read the error's goal printout, or
   use `#check`/`#eval`/`example` scratch declarations — remove scratch code before finishing.

## Style
- Small tactic steps (`intro`, `cases`, `induction`, `simp`, `exact`) beat one clever term proof —
  the user follows along in the infoview line by line.
- Never leave the file broken at the end of a turn: if you can't finish, leave a `sorry` with a
  comment saying what remains, so the editor stays green enough to keep elaborating.
- Ask before large rewrites or renaming declarations the user may be referencing.

## Adding files
New modules go under `LeanProject/` and must be imported from `LeanProject.lean` to be part of
`lake build`. The editor picks up new files automatically.