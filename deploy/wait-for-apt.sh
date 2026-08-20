#!/usr/bin/env bash
# Wait until nothing else on this droplet holds the apt/dpkg locks, then return.
#
# WHY: a freshly created DO droplet runs its OWN apt for the first minute or two — cloud-init's
# package stage and unattended-upgrades. A bake that starts installing into that race dies on its
# FIRST apt call with:
#
#   E: Could not get lock /var/lib/apt/lists/lock. It is held by process 1834 (apt-get)
#
# which is exactly how the 2026-08-20 03:28 zed derive failed, after its base snapshot had already
# been cut — 20 minutes of bake thrown away on a lock that clears itself in seconds.
#
# `-o DPkg::Lock::Timeout` does NOT cover this: it waits on the dpkg FRONTEND lock, while
# `apt-get update` dies on the LISTS lock, which has no such wait. So the wait must happen before
# apt is invoked at all.
#
# LOCKS, NOT PROCESS NAMES: `pgrep unattended-upgr` matches `unattended-upgrade-shutdown
# --wait-for-signal`, a daemon that runs for the life of the box and holds nothing — waiting on
# that name would block every bake for the full timeout. flock asks the only question that matters.
#
# Best-effort by design: every probe is optional and this script always exits 0. A bake must never
# fail because the WAIT could not run; the apt call after it is still free to fail loudly.
set -u

TIMEOUT_SECS="${APT_WAIT_TIMEOUT_SECS:-300}"
INTERVAL="${APT_WAIT_INTERVAL_SECS:-5}"
LOCKS="${APT_WAIT_LOCKS:-/var/lib/apt/lists/lock /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock}"



apt_busy() {
  local lock
  for lock in $LOCKS; do
    # A lock we cannot WRITE is a lock we cannot probe (flock could not open it, and every probe
    # would read as "held"). Skipping those is also what makes this a no-op for a non-root caller —
    # the bakes run as root; anyone else falls straight through.
    [ -e "$lock" ] && [ -w "$lock" ] || continue
    flock -n "$lock" true 2>/dev/null || return 0
  done
  return 1
}

# cloud-init knows when its own package stage is done; ask it first where it exists.
if command -v cloud-init >/dev/null 2>&1; then
  timeout "$TIMEOUT_SECS" cloud-init status --wait >/dev/null 2>&1 || true
fi

waited=0
while [ "$waited" -lt "$TIMEOUT_SECS" ] && apt_busy; do
  [ "$waited" -eq 0 ] && echo "    apt/dpkg is locked by another process — waiting (up to ${TIMEOUT_SECS}s)"
  sleep "$INTERVAL"
  waited=$((waited + INTERVAL))
done

if apt_busy; then
  # Not fatal: apt itself will report the real problem, with the real error, in a moment.
  echo "    WARNING: apt/dpkg still locked after ${TIMEOUT_SECS}s — continuing anyway" >&2
elif [ "$waited" -gt 0 ]; then
  echo "    apt free after ${waited}s"
fi
exit 0
