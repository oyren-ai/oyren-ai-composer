# Lean foundation bake — base changes never rebuild Lean

**Status: proposal, DO NOT MERGE until a bake has run it end to end.**

## Problem

Today the Lean image is *derived* from the finished base image (`derive-lean-snapshot.sh`): boot
the base, run `install-lean.sh`, snapshot. So every base change — a runtime fix, an agent pin, the
editor — forces the whole Lean derive again, serially after the 17-minute base bake: ~28 minutes
wall for "one line changed in sandbox-runtime".

Measured on the 2026-08-21 lean derive: Lean + Mathlib itself is **~4 min**; booting the droplet
(~2.5 min) and snapshotting it (~4.5 min) are the other ~7. DigitalOcean snapshots are whole disks,
not layers, so the only way to stop paying for Lean is to put it *underneath* the base provisioning
instead of on top of it.

## Design

Invert the layering. One new, rarely-rebuilt image holds only what `deploy/lean/` produces:

```
ubuntu-24-04 ──provision-remote.sh──▶ oyren-sandbox-base-<ts>            (unchanged)
ubuntu-24-04 ──foundation-remote.sh─▶ oyren-sandbox-leanfoundation-<ts>  (NEW: user + elan + Mathlib)
leanfoundation ─provision-remote.sh──▶ oyren-sandbox-lean-<ts>            (full base provisioning on top)
```

- `bake-base-snapshot.sh` learns `BASE_IMAGE` (an Ubuntu slug *or* a snapshot id) and `VARIANT`
  (`base` | `lean`, for the snapshot name). Defaults are byte-identical to today.
- `bake-lean-foundation.sh` + `foundation-remote.sh`: fresh Ubuntu, swap, git, the `oyren` user
  (same `useradd` line as `install-host.sh`), then `install-lean.sh` for the toolchain + Mathlib.
- `install-lean.sh` stays the one Lean installer and stays idempotent. Its editor step (the
  `leanprover.lean4` extension) now runs only when the editor exists — on the foundation it does
  not yet — and `bake-install.sh` re-runs `install-lean.sh` at the end of any provisioning that
  finds `~oyren/.elan`, which is what finishes the Lean layer on the lean bake. A re-run on a box
  that already has Mathlib is cheap: `lake exe cache get` only fetches what is missing.
- The workflow bakes **base and lean as two parallel jobs** off the same checkout. The lean job
  takes `lean_foundation_id` (or finds the newest `oyren-sandbox-leanfoundation-*` itself) and
  `bake_lean_foundation` rebuilds the foundation first when `deploy/lean/` changed.
- `pruneSnapshots.mjs` gains the `leanfoundation` family so pruning never mixes it with `lean`.
- `derive-lean-snapshot.sh` stays as the fallback path until the new one has baked once.

## What it buys

| | today | after |
|---|---|---|
| base change, both images | 17 + 11 min, serial | ~18 min, parallel |
| `deploy/lean/` change | 11 min derive | ~11 min foundation, then ~18 min lean |
| Lean work repeated | every lean derive | only when `deploy/lean/` changes |
| drift between images | none (lean = base + lean) | none (both are full fresh provisions) |

The lean image's 25GB disk floor is unchanged: the foundation bakes on `s-1vcpu-1gb` like the base.

## Not done here

- No bake has run this. The first run should: bake a foundation, bake lean from it, launch a Lean
  Codespace, open the template and confirm the language server and infoview work.
- `derive_zed` is already a retired no-op; it is left alone.
