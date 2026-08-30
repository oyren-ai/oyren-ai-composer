#!/usr/bin/env bash
# Prepare this droplet for a disk snapshot at session end (the orchestrator runs it through the
# control API; `oyren quiesce` runs it by hand). Runs as root. Safe to run twice.
#
#   oyren-quiesce [--json] [--dry-run]
#
# What it does, in order: stop the units that hold user processes (the tmux server with every
# shell and the agent, the streamed Zed, the in-VM browser) so the disk is quiet; drop caches the
# image can rebuild (apt lists, root's npm and cache dirs, old journal) — never anything under
# /home, never the pnpm store the agent CLIs link against; forget the per-session editor-surface
# switch so a restored droplet boots the surface its launch asks for; sync and fstrim so the
# snapshot is small (DigitalOcean bills used blocks); and LAST, `cloud-init clean --logs`, without
# which a droplet restored from the snapshot believes cloud-init already ran and never writes the
# new session's /etc/oyren/sandbox.env. Session secrets stay: the new session overwrites them.
set -uo pipefail
DRY=0 JSON=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --json) JSON=1 ;;
    *) echo "usage: oyren-quiesce [--json] [--dry-run]" >&2; exit 2 ;;
  esac
done

say() { if [ "$JSON" = 1 ]; then echo "$*" >&2; else echo "$*"; fi; }
run() { if [ "$DRY" = 1 ]; then say "would: $*"; else say "$*"; "$@"; fi; }
has() { command -v "$1" >/dev/null 2>&1; }
disk_used() { df -k / 2>/dev/null | awk 'NR==2 { print $3 * 1024 }'; }
disk_total() { df -k / 2>/dev/null | awk 'NR==2 { print $2 * 1024 }'; }

USED_BEFORE="$(disk_used)"
# The tmux layout first, while the server is still up. The blocking oneshot runs the same script,
# user and env as the two-minute timer (tmux-state.mjs, which refuses an empty server), so the
# snapshot carries exactly what the next boot of this droplet, or a clone of it, restores.
if has systemctl && systemctl is-active --quiet oyren-tmux 2>/dev/null; then
  run systemctl start oyren-tmux-save.service || true
fi
STOPPED=""
for unit in oyren-tmux oyren-browser oyren-zed; do
  if has systemctl && systemctl is-active --quiet "$unit" 2>/dev/null; then
    run systemctl stop "$unit" && STOPPED="$STOPPED${STOPPED:+,}$unit"
  fi
done

run apt-get clean
run rm -rf /var/lib/apt/lists/* /root/.npm /root/.cache
has journalctl && run journalctl --vacuum-time=2d
run rm -f /etc/oyren/editor-surface
run sync

TRIMMED=0
if [ "$DRY" = 1 ]; then
  say "would: fstrim -av"
elif has fstrim; then
  TRIM_OUT="$(fstrim -av 2>&1 || true)"
  say "$TRIM_OUT"
  TRIMMED="$(printf '%s\n' "$TRIM_OUT" | awk '/bytes/ { for (i = 1; i <= NF; i++) if ($i == "bytes") s += $(i - 1) } END { print s + 0 }')"
fi

CLEANED=false
if [ "$DRY" = 1 ]; then
  say "would: cloud-init clean --logs"
elif has cloud-init; then
  cloud-init clean --logs && CLEANED=true
fi

USED_AFTER="$(disk_used)"
FREED=$(( ${USED_BEFORE:-0} - ${USED_AFTER:-0} ))
[ "$FREED" -lt 0 ] && FREED=0
if [ "$JSON" = 1 ]; then
  printf '{"stopped":[%s],"freedBytes":%s,"trimmedBytes":%s,"diskUsedBytes":%s,"diskTotalBytes":%s,"cloudInitCleaned":%s,"dryRun":%s}\n' \
    "$(printf '%s' "$STOPPED" | sed 's/[^,]*/"&"/g')" "$FREED" "${TRIMMED:-0}" "${USED_AFTER:-0}" "$(disk_total)" "$CLEANED" "$([ "$DRY" = 1 ] && echo true || echo false)"
else
  say "✅ quiesced: stopped [${STOPPED:-none}], freed ${FREED} bytes, trimmed ${TRIMMED:-0} bytes, cloud-init cleaned: $CLEANED"
fi
