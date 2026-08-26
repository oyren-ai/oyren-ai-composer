---
name: updating-codespace
description: Bring this Oyren Codespace's runtime, editor and agent CLIs up to date in place with `oyren update`. Use when the user asks to update the machine, the image, the Codespace, the tools, or the agent CLIs, when a tool prints that it is outdated, or when the Oyren UI says an update is available. Nothing on disk is lost; shells and this agent survive the update.
---

# Updating this Codespace

This machine boots from a versioned Oyren image. A newer image is applied **in place**: only the
components whose versions changed are re-installed, the machine is never replaced, and everything
the user installed (apt packages, global tools, files, editor extensions) stays.

## Steps

1. See what is installed and what would change:

   ```bash
   oyren version
   oyren update --check
   ```

   `--check` prints one line per component, `claude 2.1.191 → 2.1.235`, and exits 3 when there is
   something to apply, 0 when the machine is already current. Read the list: note anything that
   touches tools this project depends on, and anything the user installed by hand that could shadow
   a pinned tool (a `claude` on PATH ahead of the pinned one, a global `pnpm` package).

2. Apply it:

   ```bash
   oyren update
   ```

   It prints the updater's log as it goes and ends with what changed. The tmux session (and this
   agent inside it) survives a runtime restart; anything started with `oyren start` stops and needs
   `oyren start` again; the editor tab needs a reload when the editor moved. Stop dev servers and
   watchers before, start them after.

3. Verify the tools the project uses still work (`git`, `node`, `pnpm`, the language servers, the
   agent CLI itself with `--version`), and reinstall anything the update dropped.

4. Report what changed, what you verified, and anything the user has to redo by hand.

## When it fails

`oyren update` ends with the failing step and a next step. Read `/var/log/oyren-update.log`, fix
the cause, and run `oyren update` again: it resumes from where it stopped, nothing is half-applied.
A checksum or version failure changed nothing on the machine. A runtime that did not come back was
rolled back automatically. Do not rerun blindly more than twice; tell the user what the log says.

`oyren update --status` shows the last run at any time.
