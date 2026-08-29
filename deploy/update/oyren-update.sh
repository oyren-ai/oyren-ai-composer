#!/usr/bin/env bash
# The in-place updater's entry point (installed as /usr/local/bin/oyren-update; the `oyren update`
# CLI is what people and agents call, this is what it hands the work to, as root).
#
#   oyren-update --check --manifest-url URL         what a newer release would change (exit 3 = something)
#   oyren-update --manifest-url U --tarball-url U --expect-version V [--force c]…
#                                                    apply, in a transient systemd unit; prints the unit
#   oyren-update --status                            the last run's status file
#
# The apply runs under `systemd-run --unit oyren-update-<ts>` so it survives the sandbox runtime's
# restart (a detached control `run` is a child of that runtime, and would kill itself). Presigned
# URLs never appear in argv: they go into a 0600 job file the unit reads. The download, checks and
# hand-over live in lib/fetch.sh; the apply itself is the NEW tree's apply-release.sh.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib/status.sh"
INSTALLED="${OYREN_IMAGE_MANIFEST:-/etc/oyren/image-manifest.json}"
LOCK="${OYREN_UPDATE_LOCK:-/run/lock/oyren-update.lock}"
JOB_DIR="${OYREN_UPDATE_JOBS:-/run/oyren-update}"

MODE="apply" MANIFEST_URL="" TARBALL_URL="" EXPECT_VERSION="" FORCE="" JOB="" JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE="check"; shift ;;
    --status) MODE="status"; shift ;;
    --in-unit) MODE="in-unit"; shift ;;
    --manifest-url) MANIFEST_URL="$2"; shift 2 ;;
    --tarball-url) TARBALL_URL="$2"; shift 2 ;;
    --expect-version) EXPECT_VERSION="$2"; shift 2 ;;
    --force) FORCE="$FORCE $2"; shift 2 ;;
    --job) JOB="$2"; shift 2 ;;
    --json) JSON=1; shift ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$MODE" in
  status) status_read; exit 0 ;;
  check)
    [ -n "$MANIFEST_URL" ] || { echo "usage: oyren-update --check --manifest-url URL" >&2; exit 2; }
    tmp="$(mktemp)"
    curl -fsSL --retry 2 --max-time 60 -o "$tmp" "$MANIFEST_URL" || { echo "could not download the release manifest" >&2; rm -f "$tmp"; exit 1; }
    node "$HERE/../manifest/manifestCli.mjs" diff "$INSTALLED" "$tmp" $([ "$JSON" = 1 ] && echo --json)
    code=$?
    rm -f "$tmp"
    exit $code ;;
  apply)
    [ -n "$MANIFEST_URL" ] && [ -n "$TARBALL_URL" ] || { echo "usage: oyren-update --manifest-url U --tarball-url U [--expect-version V] [--force c]" >&2; exit 2; }
    if [ "$(status_field state)" = "running" ] && systemctl is-active --quiet "$(status_field unit)" 2>/dev/null; then
      echo "an update is already running ($(status_field unit)); follow it with: oyren update --status" >&2
      exit 4
    fi
    mkdir -p "$JOB_DIR" && chmod 0700 "$JOB_DIR"
    JOB="$JOB_DIR/job-$(date -u +%Y%m%dT%H%M%S).env"
    umask 077
    printf 'MANIFEST_URL=%q\nTARBALL_URL=%q\nEXPECT_VERSION=%q\nFORCE=%q\n' "$MANIFEST_URL" "$TARBALL_URL" "$EXPECT_VERSION" "${FORCE# }" > "$JOB"
    UNIT="oyren-update-$(date -u +%Y%m%dT%H%M%S)"
    status_write running starting --unit "$UNIT" --to "$EXPECT_VERSION" --from "$(node -p 'try { require(process.argv[1]).version || "" } catch { "" }' "$INSTALLED")" --changed "" --applied "" --error ""
    systemd-run --unit="$UNIT" --collect --quiet --property=After=network-online.target \
      --setenv=OYREN_UPDATE_STATUS="$STATUS_FILE" --setenv=OYREN_UPDATE_LOG="$LOG_FILE" \
      -- /usr/local/bin/oyren-update --in-unit --job "$JOB" \
      || { status_fail starting "could not start the update unit (systemd-run failed)"; exit 1; }
    if [ "$JSON" = 1 ]; then printf '{"unit":"%s","status":"%s"}\n' "$UNIT" "$STATUS_FILE"; else echo "update started in unit $UNIT; follow it with: oyren update --status"; fi
    exit 0 ;;
  in-unit)
    [ -n "$JOB" ] && [ -f "$JOB" ] || { status_fail starting "missing job file"; exit 2; }
    exec 9>"$LOCK"
    flock -n 9 || { status_fail starting "another update holds the lock"; exit 4; }
    source "$HERE/lib/fetch.sh"
    fetch_release "$JOB"
    exit $? ;;
esac
