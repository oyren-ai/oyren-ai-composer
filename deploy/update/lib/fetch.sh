#!/usr/bin/env bash
# SOURCE this file. Download the release named in the job file, prove it is the one we expect,
# unpack it beside the installed tree, and hand over to the NEW tree's apply-release.sh — so the
# apply logic that runs is always the target version's, and a bake can change how its own
# components install.
#
# Verification before anything touches the disk: the tarball's sha256 must match the manifest, the
# manifest's version must be the one the caller expected, and its updaterProtocol must not be newer
# than the installed tree understands. A failed check leaves the machine exactly as it was.

_sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -c1-64; else shasum -a 256 "$1" | cut -c1-64; fi
}

# fetch_release <job-file> — job lines: MANIFEST_URL=, TARBALL_URL=, EXPECT_VERSION=, FORCE=.
fetch_release() {
  local job="$1" root="${COMPOSER_ROOT:-/srv/composer/app}" tmp want got version protocol ours
  local MANIFEST_URL="" TARBALL_URL="" EXPECT_VERSION="" FORCE=""
  # shellcheck disable=SC1090
  source "$job"
  [ -n "$MANIFEST_URL" ] && [ -n "$TARBALL_URL" ] || { status_fail fetching "job file lacks MANIFEST_URL/TARBALL_URL"; return 1; }

  tmp="$(mktemp -d)"
  status_write running fetching
  log "fetching manifest and release tarball"
  curl -fsSL --retry 3 --max-time 120 -o "$tmp/manifest.json" "$MANIFEST_URL" \
    || { status_fail fetching "could not download the release manifest (is the presigned URL still valid?)"; return 1; }
  curl -fsSL --retry 3 --max-time 600 -o "$tmp/release.tar.gz" "$TARBALL_URL" \
    || { status_fail fetching "could not download the release tarball"; return 1; }

  status_write running verifying
  want="$(node -p 'try { require(process.argv[1]).artifact.sha256 } catch { "" }' "$tmp/manifest.json")"
  got="$(_sha256_of "$tmp/release.tar.gz")"
  [ -n "$want" ] && [ "$want" = "$got" ] \
    || { status_fail verifying "checksum mismatch: the tarball is not the one the manifest describes; nothing was changed"; return 1; }
  version="$(node -p 'try { require(process.argv[1]).version } catch { "" }' "$tmp/manifest.json")"
  if [ -n "$EXPECT_VERSION" ] && [ "$version" != "$EXPECT_VERSION" ]; then
    status_fail verifying "the release is version '$version', not the expected '$EXPECT_VERSION'; nothing was changed"; return 1
  fi
  protocol="$(node -p 'try { Number(require(process.argv[1]).updaterProtocol) || 1 } catch { 1 }' "$tmp/manifest.json")"
  ours="$(grep -E '^UPDATER_PROTOCOL=' "$root/deploy/versions.env" 2>/dev/null | cut -d= -f2 || true)"
  if [ "$protocol" -gt "${ours:-1}" ]; then
    status_fail verifying "this release needs updater protocol $protocol, this machine understands ${ours:-1}; it needs a fresh Codespace"; return 1
  fi
  log "release $version verified (sha256 $got)"

  rm -rf "$root.new"
  mkdir -p "$root.new"
  tar -xzf "$tmp/release.tar.gz" --strip-components=1 -C "$root.new" \
    || { status_fail verifying "could not unpack the release tarball"; rm -rf "$root.new"; return 1; }
  cp "$tmp/manifest.json" "$root.new/deploy/manifest/target.json"
  rm -rf "$tmp"
  [ -f "$root.new/deploy/update/apply-release.sh" ] \
    || { status_fail verifying "the release has no apply-release.sh; it predates in-place updates"; rm -rf "$root.new"; return 1; }
  log "handing over to $root.new/deploy/update/apply-release.sh"
  exec_apply "$root.new/deploy/update/apply-release.sh" --job "$job"
}

# Test seam: OYREN_UPDATE_APPLY_CMD replaces the exec (prints instead of applying).
exec_apply() {
  if [ -n "${OYREN_UPDATE_APPLY_CMD:-}" ]; then "$OYREN_UPDATE_APPLY_CMD" "$@"; return $?; fi
  exec bash "$@"
}
