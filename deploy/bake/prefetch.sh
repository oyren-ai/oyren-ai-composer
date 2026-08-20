#!/usr/bin/env bash
# The bake's download cache. SOURCE this file — never execute it.
#
# WHY: the first ~100 seconds of a bake are spent waiting for cloud-init to let go of the apt lock
# and then installing Docker CE — apt work that one vCPU and the dpkg lock make strictly serial,
# with the network sitting idle throughout. Meanwhile the bake later stops dead to download a Zed
# tarball, a KasmVNC deb and an openvscode-server tarball, one after another, with the CPU idle.
# Moving those fetches INTO the early window costs nothing and removes them from the critical path.
#
# NO DRIFTING COPY OF THE PINS. The prefetcher does not hardcode any URL: it asks each installer
# script for its own, via `--print-assets` (see install-zed-stack.sh / install-editor.sh), which
# prints "<cache-name> <url>" lines and exits before any side effect. One source of truth for every
# pinned version, and a bumped pin can never silently prefetch the old artifact.
#
# A PREFETCH MISS IS NOT A FAILURE. Consumers call cached_curl/cached_untar, which use the cached
# file when it is there and download it themselves when it is not. That is deliberate: the fetch is
# an optimisation, the consumer still needs the bytes either way, and the consumer's own download is
# still `set -e` fatal — so nothing can be hidden by a prefetch that did not happen. What a miss
# costs is time, which is exactly what the prefetch was buying.
#
# Cached files are ~400MB. The bake's final cleanup deletes the whole directory so none of it is
# baked into the snapshot.

BAKE_CACHE_DIR="${BAKE_CACHE_DIR:-/var/cache/oyren-bake}"

# prefetch_into_cache <name> <url> — download one asset into the cache.
# The download lands on a .part file and is renamed only after curl exits 0, so an interrupted or
# truncated fetch can never be picked up later as a complete artifact — the failure mode that would
# otherwise bake a half-extracted tree into an image.
prefetch_into_cache() {
  local name="$1" url="$2" tmp
  mkdir -p "$BAKE_CACHE_DIR"
  tmp="$BAKE_CACHE_DIR/.$name.part"
  rm -f "$tmp"
  # Guarded, not left to the caller's errexit: `curl -o` CREATES the output file before it discovers
  # the transfer has failed, so an unguarded failure would rename an empty .part into place and hand
  # every later consumer a "cached" zero-byte artifact. Delete the stub and report instead.
  if ! curl -fsSL --retry 3 --retry-delay 2 -o "$tmp" "$url"; then
    rm -f "$tmp"
    echo "    prefetch FAILED for $name from $url — the consumer will download it itself" >&2
    return 1
  fi
  mv -f "$tmp" "$BAKE_CACHE_DIR/$name"
  echo "    prefetched $name ($(du -h "$BAKE_CACHE_DIR/$name" | cut -f1)) from $url"
}

# prefetch_assets <installer-script>… — fetch everything the given installers declare, in order.
# Serial on purpose: the droplet's link already saturates on one download (20MB/s measured), so
# concurrent curls would only make the log harder to read for no gain.
prefetch_assets() {
  local script name url rc=0 found
  for script in "$@"; do
    [ -f "$script" ] || { echo "    skipping $script (not present)"; continue; }
    found=0
    while read -r name url; do
      [ -n "${name:-}" ] && [ -n "${url:-}" ] || continue
      found=$((found + 1))
      prefetch_into_cache "$name" "$url" || rc=$?
    done < <(bash "$script" --print-assets)
    # An installer that declared nothing is a --print-assets contract that broke (renamed flag,
    # a `set -e` exit above it). Not fatal — the installer will still download its own artifact —
    # but it must be visible, or the prefetch silently stops paying and nobody notices.
    [ "$found" -gt 0 ] \
      || echo "    WARNING: $script declared no assets — its --print-assets contract may have moved" >&2
  done
  return "$rc"
}

# cached_curl <name> <url> <dest> — put the asset at <dest>, from the cache if it was prefetched.
cached_curl() {
  local name="$1" url="$2" dest="$3"
  if [ -f "$BAKE_CACHE_DIR/$name" ]; then
    echo "    using prefetched $name"
    cp -f "$BAKE_CACHE_DIR/$name" "$dest"
    return 0
  fi
  echo "    downloading $name (not prefetched)"
  curl -fsSL --retry 3 -o "$dest" "$url"
}

# cached_untar <name> <url> <dest-dir> — extract the asset into <dest-dir>, from the cache if it was
# prefetched. Same contract as the `curl … | tar -xz` it replaces: any failure is fatal to a
# `set -euo pipefail` caller, and nothing is left half-extracted for the caller's asserts to inspect.
cached_untar() {
  local name="$1" url="$2" dest="$3"
  if [ -f "$BAKE_CACHE_DIR/$name" ]; then
    echo "    using prefetched $name"
    tar -xzf "$BAKE_CACHE_DIR/$name" -C "$dest"
    return 0
  fi
  echo "    downloading $name (not prefetched)"
  curl -fsSL --retry 3 "$url" | tar -xz -C "$dest"
}
