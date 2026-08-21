// The one decision a terminal connection makes before anything else: what to put on the PTY.
// Kept apart from terminal.js so the choice has no `ws`/`node-pty` in reach — it is a pure
// function of the option upgrade.js parsed off the URL, and is tested as one (terminal.test.js).

// `-u` forces tmux UTF-8 mode so multibyte glyphs (Claude Code's ✻/box-drawing/❯) pass through
// intact — insurance on top of the image's LANG=C.UTF-8 (Dockerfile). `-A` re-attaches "main" if it
// already exists, which is what lets a closed tab come back to its running processes.
const TMUX_ARGS = ["-u", "new-session", "-A", "-s", "main"]

/**
 * Spawn the PTY for one connection. `shell: "plain"` is the user's login shell straight on the PTY —
 * no session to re-attach, but also no tmux between xterm.js and the program (tmux captures the
 * mouse, so drag-select and wheel-scroll stop being the browser's). Anything else is tmux: the
 * default, and the fallback for a value nobody defined, so an unknown option can never produce a
 * third kind of terminal.
 */
function spawnTerminal(spawn, { shell, workdir, env }) {
  const options = { name: "xterm-256color", cols: 80, rows: 24, cwd: workdir, env }
  if (shell === "plain") return spawn(env.SHELL || "/bin/bash", ["-l"], options)
  return spawn("tmux", TMUX_ARGS, options)
}

module.exports = { spawnTerminal, TMUX_ARGS }
