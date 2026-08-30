#!/usr/bin/env bash
# ExecStart of oyren-tmux.service: decode the session env, then BECOME the tmux server.
#
# The exec is the point. With tmux as the unit's main process, nothing node-shaped sits above the
# server for a stray `pkill node` or the OOM killer to take first, and systemd supervises the real
# thing. `-u` forces UTF-8; `-D` runs the server in the foreground and turns exit-empty off, so a
# server whose last session closed stays up for the next attach. `-D` also refuses any trailing
# command (tmux.c usage()s on CLIENT_NOFORK + argc), which is exactly how the previous form of this
# unit shipped dead and usage-looped on every droplet; startTmux.test.mjs pins both facts.
#
# A shell wrapper rather than an ExecStart one-liner because systemd expands `$VAR` itself and the
# escaping (`$$session_env`) is exactly the kind of line nobody reads twice.
set -euo pipefail
session_env="$(/usr/bin/node /usr/local/lib/oyren/start-tmux.mjs --export-env)"
eval "$session_env"
exec /usr/bin/tmux -u -D
