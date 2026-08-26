#!/usr/bin/env bash
# SOURCE this file. `tree_hash <path>…` prints a short content hash (`t-` + 12 hex) over every
# regular file under the given paths, excluding node_modules, dist and .git. File names are part of
# the hash, so run it from the SAME directory with the SAME relative paths wherever it must agree:
# the bake runner hashes `sandbox-runtime deploy/sandbox-host` from the git checkout, and the
# droplet hashes the same paths from /srv/composer/app. Only contents and names count, never modes
# or timestamps, which is what lets an rsynced tree hash like the checkout it came from.

_tree_hash_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -c1-64
  else shasum -a 256 | cut -c1-64
  fi
}

tree_hash() {
  local path file out
  [ "$#" -gt 0 ] || { echo "ERROR: tree_hash needs at least one path" >&2; return 1; }
  # Checked up front: an `exit` inside the pipeline below would be swallowed by the last stage's
  # status, and a missing path must never hash as "empty tree".
  for path in "$@"; do
    [ -e "$path" ] || { echo "ERROR: tree_hash: no such path: $path" >&2; return 1; }
  done
  out="$(
    for path in "$@"; do
      find "$path" -type f \
        -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.git/*'
    done | LC_ALL=C sort | while IFS= read -r file; do
      printf '%s  %s\n' "$(_tree_hash_sha256 < "$file")" "$file"
    done | _tree_hash_sha256
  )" || return 1
  printf 't-%s\n' "${out:0:12}"
}
