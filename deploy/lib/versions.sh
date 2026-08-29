#!/usr/bin/env bash
# SOURCE this file. `load_versions [file]` exports every KEY=VALUE from deploy/versions.env that is
# not already set in the environment, so a caller's own `CLAUDE_VERSION=… bash install-agents.sh`
# still wins, exactly as the old per-script `${X:-default}` lines did.
#
# The file format is deliberately tiny (KEY=VALUE, `#` comments, no quoting) so that the same file
# is parsed identically here and in deploy/manifest/manifest.mjs.

load_versions() {
  local file="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/versions.env}"
  local line key value
  [ -f "$file" ] || { echo "ERROR: versions file not found: $file" >&2; return 1; }
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    line="${line//[[:space:]]/}"
    [ -z "$line" ] && continue
    key="${line%%=*}"
    value="${line#*=}"
    if ! [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || [ "$key" = "$line" ]; then
      echo "ERROR: $file: expected KEY=VALUE, got: $line" >&2
      return 1
    fi
    if [ -z "${!key+set}" ]; then
      export "$key=$value"
    fi
  done < "$file"
}
