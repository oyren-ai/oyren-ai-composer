#!/usr/bin/env bash
# SOURCE this file. How the session runtime lands on a droplet, shared by the bake and by a live
# update: staged into its own directory under /srv/oyren/runtime/<tree-hash>, then made current by
# flipping the /app symlink. A running server keeps the old tree (open files, cwd) until it is
# restarted, a new terminal or agent launch after the flip sees the new one, and nothing is ever
# deleted underneath a process — which is what the old `rm -rf /app && cp` could not promise.

# image_family — "base" | "lean" | "" from the installed manifest.
image_family() {
  node -p 'try { require(process.env.OYREN_IMAGE_MANIFEST || "/etc/oyren/image-manifest.json").family || "" } catch { "" }' 2>/dev/null || true
}

# stage_runtime <src> <dest> [lean-skills-dir] — copy the runtime tree, install its production
# deps (node-pty builds natively), merge the lean skills on a lean image, hand it to the sandbox
# user. Refuses to stage over the directory /app currently points at.
stage_runtime() {
  local src="$1" dest="$2" skills="${3:-}" link="${APP_LINK:-/app}"
  # Plain readlink: the link always holds an absolute path we wrote, and BSD readlink has no -f.
  if [ "$(readlink "$link" 2>/dev/null || true)" = "$dest" ]; then
    echo "ERROR: $dest is the active runtime; refusing to stage over it" >&2
    return 1
  fi
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -a "$src"/. "$dest"/
  rm -rf "$dest/node_modules"
  (cd "$dest" && pnpm install --prod --frozen-lockfile)
  # pnpm 10 only runs node-pty's build because package.json lists it under
  # pnpm.onlyBuiltDependencies, a field pnpm 11 no longer reads. Load it here so a silently skipped
  # build fails the bake or the update instead of shipping a dead terminal.
  (cd "$dest" && node -e 'require("node-pty")') \
    || { echo "ERROR: node-pty did not build in $dest — the web terminal would be dead." >&2; return 1; }
  if [ -n "$skills" ] && [ -d "$skills" ]; then
    mkdir -p "$dest/skills"
    cp -a "$skills"/. "$dest/skills"/
  fi
  chown -R "${SANDBOX_USER:-oyren}:${SANDBOX_USER:-oyren}" "$dest"
}

# activate_runtime <dest> [link] — point the link (default /app) at <dest>. A real directory at the
# link (an image from before staging) is moved aside once, never deleted. The flip itself is a
# rename, so there is no moment without a runtime.
activate_runtime() {
  local dest="$1" link="${2:-${APP_LINK:-/app}}" tmp
  if [ -d "$link" ] && [ ! -L "$link" ]; then
    mv "$link" "$(dirname "$dest")/legacy-$(date +%s)"
  fi
  tmp="$link.tmp.$$"
  ln -sfn "$dest" "$tmp"
  if mv --help 2>&1 | grep -q -- --no-target-directory; then
    mv -T "$tmp" "$link"
  else
    rm -f "$link" && mv "$tmp" "$link"
  fi
}

# prune_runtimes <root> <current> — keep the current tree and the newest other one (the rollback
# target of lib/restart.sh); everything older goes.
prune_runtimes() {
  local root="$1" current="$2" kept=0 entry
  for entry in $(ls -1td "$root"/*/ 2>/dev/null); do
    entry="${entry%/}"
    [ "$entry" = "$current" ] && continue
    if [ "$kept" -lt 1 ]; then kept=$((kept + 1)); continue; fi
    rm -rf "$entry"
  done
}
