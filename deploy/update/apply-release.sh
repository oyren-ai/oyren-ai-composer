#!/usr/bin/env bash
# Apply a verified release to this droplet. Runs FROM the new tree ($COMPOSER_ROOT.new, unpacked by
# lib/fetch.sh) as root inside the updater's own systemd unit, so a runtime restart at the end
# cannot kill it. Only the components whose manifest value differs from the installed one move
# (plus anything named in FORCE); each is stamped as it lands, so a run that stops half-way leaves
# a manifest that says exactly which parts are new and the next run picks up from there. The
# image version flips only when every component matches the target.
set -uo pipefail
NEW_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT="${COMPOSER_ROOT:-/srv/composer/app}"
INSTALLED="${OYREN_IMAGE_MANIFEST:-/etc/oyren/image-manifest.json}"
TARGET="$NEW_ROOT/deploy/manifest/target.json"
CLI="$NEW_ROOT/deploy/manifest/manifestCli.mjs"
source "$NEW_ROOT/deploy/update/lib/status.sh"
source "$NEW_ROOT/deploy/update/lib/components.sh"
source "$NEW_ROOT/deploy/update/lib/restart.sh"

JOB=""; [ "${1:-}" = "--job" ] && JOB="$2"
FORCE=""; [ -n "$JOB" ] && FORCE="$(grep -E '^FORCE=' "$JOB" 2>/dev/null | cut -d= -f2- || true)"
TO="$(node -p 'require(process.argv[1]).version' "$TARGET")"
FROM="$(node -p 'try { require(process.argv[1]).version || "" } catch { "" }' "$INSTALLED")"

# What differs, in the fixed order. `changed` is recorded up front so a watcher sees the plan.
DIFF="$(node "$CLI" diff "$INSTALLED" "$TARGET" --json)"
in_diff() { node -e 'process.exit(JSON.parse(process.argv[1]).some((d) => d.component === process.argv[2]) ? 0 : 1)' "$DIFF" "$1"; }
target_value() { node -p 'const v = require(process.argv[1]).components[process.argv[2]]; v == null ? "null" : String(v)' "$TARGET" "$1"; }
TODO=""
for c in $COMPONENT_ORDER; do
  if in_diff "$c" || [[ " $FORCE " == *" $c "* ]]; then TODO="$TODO $c"; fi
done
TODO="${TODO# }"
status_write running starting --from "$FROM" --to "$TO" --changed "$(echo "$TODO" | tr ' ' ',')"
log "update $FROM -> $TO: ${TODO:-nothing to apply}"

for c in $TODO; do
  reason="$(refuse_reason "$c")"
  [ -z "$reason" ] || { status_fail "applying:$c" "$reason"; exit 1; }
done

APPLIED=""
RESTART=""
PREVIOUS_RUNTIME="$(readlink /app 2>/dev/null || true)"
kinds_done=""
for c in $TODO; do
  kind="$(apply_kind "$c")"
  # One installer call covers every component of its kind (all changed agent CLIs in one pass).
  case " $kinds_done " in *" $kind "*) continue ;; esac
  group=""
  for d in $TODO; do [ "$(apply_kind "$d")" = "$kind" ] && group="$group $d"; done
  group="${group# }"
  status_write running "applying:$c" --applied "$(echo "$APPLIED" | tr ' ' ',')"
  log "applying $kind: $group"
  if ! apply_group "$kind" "$NEW_ROOT" $group >>"$LOG_FILE" 2>&1; then
    status_fail "applying:$c" "the $kind installer failed while applying '$group'; see $LOG_FILE. Everything applied before it is in place; re-run to resume."
    exit 1
  fi
  for d in $group; do
    node "$CLI" stamp "$INSTALLED" "$d" "$(target_value "$d")" >/dev/null
    APPLIED="$APPLIED $d"
    RESTART="$RESTART $(restart_for "$d")"
  done
  kinds_done="$kinds_done $kind"
done
APPLIED="${APPLIED# }"

# The new tree becomes the installed tree. This script keeps running (bash holds its file open).
if [ "$NEW_ROOT" = "$ROOT.new" ]; then
  rm -rf "$ROOT.prev"
  mv -T "$ROOT" "$ROOT.prev" 2>/dev/null || mv "$ROOT" "$ROOT.prev"
  mv -T "$NEW_ROOT" "$ROOT" 2>/dev/null || mv "$NEW_ROOT" "$ROOT"
  log "installed tree is now $ROOT (previous kept at $ROOT.prev)"
fi

status_write running restarting --applied "$(echo "$APPLIED" | tr ' ' ',')"
restart_units $RESTART
case " $RESTART " in
  *" oyren-sandbox "*)
    WANT="$(target_value runtime)"
    if ! wait_runtime_health "$WANT"; then
      rollback_runtime "$PREVIOUS_RUNTIME" "$ROOT"
      node "$CLI" stamp "$INSTALLED" runtime "$(node -p 'try { require(process.argv[1]).components.runtime || "null" } catch { "null" }' "$ROOT.prev/deploy/manifest/target.json" 2>/dev/null || echo null)" >/dev/null
      status_fail restarting "the new runtime did not answer health within 60 s; rolled back to the previous runtime. Everything else applied."
      exit 1
    fi ;;
esac

# Every component now matches the target: the whole manifest, version included, becomes current.
if [ "$(node "$CLI" diff "$INSTALLED" "$TARGET" --json)" = "[]" ]; then
  install -m 0644 "$TARGET" "$INSTALLED"
fi
status_write done done --applied "$(echo "$APPLIED" | tr ' ' ',')"
log "update to $TO done (${APPLIED:-nothing changed})"
