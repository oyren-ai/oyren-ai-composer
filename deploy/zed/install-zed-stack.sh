#!/usr/bin/env bash
# The zed snapshot's third-party stack: KasmVNC (X server + web client + WebSocket on one port),
# openbox (something for Zed to maximize under), lavapipe (software Vulkan — the droplets have no
# GPU), and a PINNED Zed Linux build. Called by install-zed.sh; runs as root on a droplet booted
# from the base snapshot. Idempotent: safe to re-run.
#
# Versions are PINNED (bump deliberately, one at a time, and re-derive). The asserts below fail the
# bake LOUDLY when an upstream layout or escape hatch moves — never ship a snapshot past them.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
APT="apt-get -o DPkg::Lock::Timeout=300"

KASMVNC_VERSION="${KASMVNC_VERSION:-1.5.0}"
ZED_VERSION="${ZED_VERSION:-1.15.0}"
KASMVNC_DEB_URL="${KASMVNC_DEB_URL:-https://github.com/kasmtech/KasmVNC/releases/download/v${KASMVNC_VERSION}/kasmvncserver_noble_${KASMVNC_VERSION}_amd64.deb}"
ZED_TARBALL_URL="${ZED_TARBALL_URL:-https://github.com/zed-industries/zed/releases/download/v${ZED_VERSION}/zed-linux-x86_64.tar.gz}"

# openbox: the WM. dbus: dbus-run-session for Zed's private bus. mesa-vulkan-drivers: lavapipe;
# libvulkan1: the loader; vulkan-tools: bake-time proof lavapipe enumerates. libxkbcommon/asound:
# Zed's dynamic-link deps a server image lacks. fontconfig+dejavu: fallback glyphs.
echo "==> apt packages (openbox, dbus, lavapipe, X client libs)"
$APT update -qq
$APT install -y -qq --no-install-recommends \
  openbox dbus mesa-vulkan-drivers libvulkan1 vulkan-tools \
  libxkbcommon-x11-0 libasound2t64 fontconfig fonts-dejavu-core

echo "==> KasmVNC ${KASMVNC_VERSION}"
curl -fsSL -o /tmp/kasmvncserver.deb "$KASMVNC_DEB_URL"
$APT install -y -qq /tmp/kasmvncserver.deb
rm -f /tmp/kasmvncserver.deb
# The deb has renamed its X server across releases; the launcher resolves the same pair at runtime.
command -v Xkasmvnc >/dev/null || command -v Xvnc >/dev/null \
  || { echo "ERROR: no KasmVNC X server binary (Xkasmvnc/Xvnc) — deb layout changed:" >&2; dpkg -L kasmvncserver >&2; exit 1; }
[ -d /usr/share/kasmvnc/www ] \
  || { echo "ERROR: KasmVNC web client dir /usr/share/kasmvnc/www missing — deb layout changed:" >&2; dpkg -L kasmvncserver | grep -i www >&2; exit 1; }
command -v dbus-run-session >/dev/null \
  || { echo "ERROR: dbus-run-session missing (noble's dbus packaging split moved?)" >&2; exit 1; }

echo "==> Zed ${ZED_VERSION} -> /opt/zed"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT # a failed download must not bake a half-extracted tree into the snapshot
curl -fsSL "$ZED_TARBALL_URL" | tar -xz -C "$TMP"
# Exactly one top-level entry (expected zed.app/) — a changed tarball layout must fail, not
# silently install whichever entry `ls` printed first.
[ "$(ls -A "$TMP" | wc -l)" -eq 1 ] \
  || { echo "ERROR: Zed tarball no longer has a single top-level entry:" >&2; ls -A "$TMP" >&2; exit 1; }
ENTRY="$(ls -A "$TMP")"
rm -rf "/opt/zed-${ZED_VERSION}"
mv "$TMP/$ENTRY" "/opt/zed-${ZED_VERSION}"
ln -sfn "/opt/zed-${ZED_VERSION}" /opt/zed
ln -sf /opt/zed/bin/zed /usr/local/bin/zed
[ -x /opt/zed/bin/zed ] && [ -x /opt/zed/libexec/zed-editor ] \
  || { echo "ERROR: Zed tarball layout changed (no bin/zed + libexec/zed-editor under $ENTRY)" >&2; exit 1; }

# HARD REQUIREMENT (zed-snapshot-bake.md): the emulated-GPU escape hatch must exist in the PINNED
# build — it has moved before, and without it Zed refuses lavapipe and the stream shows nothing.
grep -qa ZED_ALLOW_EMULATED_GPU /opt/zed/libexec/zed-editor \
  || { echo "ERROR: ZED_ALLOW_EMULATED_GPU not found in zed-editor ${ZED_VERSION} — do NOT ship this bake" >&2; exit 1; }
# The launcher runs `zed --foreground` so the unit supervises the real editor process; a CLI that
# dropped the flag would daemonize and read as an instant crash-loop. Captured into a var first:
# under pipefail, grep -q closing the pipe early would SIGPIPE the CLI into a false bake failure.
ZED_HELP="$(/opt/zed/bin/zed --help 2>&1 || true)"
grep -q foreground <<<"$ZED_HELP" \
  || { echo "ERROR: zed CLI ${ZED_VERSION} lost --foreground — start-zed.mjs depends on it" >&2; exit 1; }

# lavapipe must actually enumerate as a Vulkan device — no display needed, the loader alone
# answers. Without this, ZED_ALLOW_EMULATED_GPU has nothing to allow and the stream shows nothing.
VKINFO="$(vulkaninfo --summary 2>&1 || true)"
grep -qi llvmpipe <<<"$VKINFO" \
  || { echo "ERROR: lavapipe (llvmpipe) does not enumerate via vulkaninfo — mesa install broken:" >&2; tail -n 20 <<<"$VKINFO" >&2; exit 1; }

echo "✅ zed stack installed (KasmVNC ${KASMVNC_VERSION}, Zed ${ZED_VERSION})"
