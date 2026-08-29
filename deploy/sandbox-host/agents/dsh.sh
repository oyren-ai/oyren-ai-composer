#!/usr/bin/env bash
# SOURCE this file. The DeepSeek Harness: pnpm as well, but into its OWN project under /opt rather
# than the global set. The global allowlist is one list for the whole install, and dsh's names
# node-pty and protobufjs, which the CLIs also depend on with their builds deliberately skipped: a
# `pnpm add -g` of dsh quietly gyp-builds claude's node-pty too (seen in a local run). A private
# project keeps the two allowlists apart and never re-links the global tree.
#
# Each version lands in its own directory and /opt/oyren-dsh is a symlink to the current one, so a
# live update installs the new build beside the old and flips; a running harness keeps its tree.
# The wrapper is a script, not a symlink: pnpm's .bin shim locates its package relative to $0.
#
# It used to be the one npm install (on the belief that pnpm's isolated store broke its Cordis
# plugin loader). Re-tested 2026-08-21 with the pinned pnpm: `dsh --version`, `--help` and
# `--profile web` all boot from a pnpm install. On linux-x64 the build scripts its native seams
# declare are no-ops today (prebuilt binaries), but naming them is what keeps a later rc that
# genuinely needs a build from installing silently half-built. Its tag IS a developer-preview rc,
# which is why the pin matters more here than anywhere else.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dsh-trusted-host.sh"

# install_dsh <version> [link] — install into /opt/oyren-dsh-<version>, flip the link, smoke it.
install_dsh() {
  local version="$1" link="${2:-/opt/oyren-dsh}" dir smoke
  dir="${link}-${version}"
  echo "==> deepseek harness ${version} -> ${dir}"
  rm -rf "$dir"
  install -d -m 0755 "$dir"
  printf '{ "name": "oyren-dsh", "private": true }\n' > "$dir/package.json"
  (cd "$dir" && HOME=/root pnpm add \
    --allow-build=@deepseek-ai/dsh-subprocess-local \
    --allow-build=koffi \
    --allow-build=node-pty \
    --allow-build=@google/genai \
    --allow-build=protobufjs \
    "@deepseek-ai/dsh@${version}")
  patch_dsh_trusted_host "$dir" || return 1
  # An image from before versioned dirs has a real directory at the link: move it aside once.
  if [ -d "$link" ] && [ ! -L "$link" ]; then mv "$link" "${link}-legacy-$(date +%s)"; fi
  ln -sfn "$dir" "$link"
  printf '%s\n' '#!/bin/sh' "exec \"${link}/node_modules/.bin/dsh\" \"\$@\"" > /usr/local/bin/dsh
  chmod 0755 /usr/local/bin/dsh
  # Same reasoning as claude's smoke check: only running it proves the install is usable — a
  # half-resolved plugin tree still leaves a `dsh` on PATH that dies on its first boot.
  smoke="$(HOME=/root timeout 60 dsh --version 2>&1 || true)"
  case "$smoke" in
    *"$version"*) echo "    dsh smoke: $smoke" ;;
    *) echo "ERROR: dsh does not run after install: $smoke" >&2; return 1 ;;
  esac
  dsh_settings_trust_smoke || return 1
  # Older versioned dirs are dead weight once the new one runs.
  local old
  for old in "${link}"-*/; do
    old="${old%/}"
    [ "$old" = "$dir" ] && continue
    case "$old" in *-legacy-*) continue ;; esac
    rm -rf "$old"
  done
}
