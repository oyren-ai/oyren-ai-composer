# Vendored tmux plugins

## tmux-resurrect

- Upstream: https://github.com/tmux-plugins/tmux-resurrect
- Commit: cff343cf9e81983d3da0c8562b01616f12e8d548 (master, 2023-03-06)
- License: MIT (LICENSE.md alongside)
- Contents: resurrect.tmux, scripts/, save_command_strategies/, strategies/ (tests, docs and video
  are left out). UNMODIFIED: re-vendor by copying a newer upstream checkout over this directory.

Vendored rather than cloned at bake so the runtime tree hash covers it (an update ships it like any
runtime change), the bake needs no network for it, and the tests can run the real plugin from the
repo path. Every CALL into it goes through /usr/local/lib/oyren/tmux-state.mjs, which owns the
per-session save directory and refuses to save an empty server; see deploy/sandbox-host.
