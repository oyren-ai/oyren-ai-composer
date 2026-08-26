# Sandbox images: versions, releases and in-place updates

Every bake of the sandbox image gets a version stamp (UTC, `YYYY-MM-DD-HHMM`). The stamp names the
DigitalOcean snapshot (`oyren-sandbox-<family>-<version>`, families `base` and `lean`), the manifest
inside the image (`/etc/oyren/image-manifest.json`) and the release the bake publishes. A running
Codespace can move to a newer version without being replaced.

## What a bake produces

- `deploy/versions.env` is the one place every pin lives. The installers source it
  (`deploy/lib/versions.sh`) and stamp their component into the manifest as they finish
  (`deploy/manifest/stamp.sh`); `bake-install.sh` writes the whole manifest last
  (`deploy/manifest/write-manifest.sh`): version, family, composer sha, every pin, and content
  hashes of the `runtime`, `host` and `browser` trees (`deploy/lib/tree-hash.sh`).
- The workflow (`.github/workflows/bake-snapshots.yml`) builds `release.tar.gz` (a git archive of
  `deploy/` and `sandbox-runtime/`) plus a manifest per family (`deploy/bake/build-release.sh`), bakes
  the snapshot under a `candidate-` name, smoke-boots it and promotes it by renaming
  (`deploy/bake/promote-snapshot.sh`), then publishes to the private Spaces bucket
  (`deploy/bake/publish-release.sh`):

  ```
  sandbox-releases/<family>/<version>/manifest.json
  sandbox-releases/<family>/<version>/release.tar.gz
  sandbox-releases/<family>/latest.json        written only once promoted
  ```

  The publish runs once per bucket in the `SPACES_RELEASES_BUCKETS` variable, with the same key
  pair, so dev and prod get the same release from one run.

- Last, it registers the promoted image with each orchestrator in `IMAGE_REGISTRY_TARGETS`
  (`deploy/bake/registerImage.mjs`). That row is what a launch boots; nothing scans DigitalOcean for
  image names any more, and `latest.json` is published but no longer read.

- Rollback is `pnpm images:prod deactivate --key CODESPACE_BASE --version <version> --reason "..."`
  on the orchestrator: the previous active row is latest again, immediately, with no rename here.
  Renaming to `retired-oyren-sandbox-…` still works and the prune workflow keeps retired images as
  their own family, but it is no longer how a bad bake is taken out of service.

- A registration that fails after the image was already promoted does not need a rebake: re-run the
  workflow with `register_only` and the version, and it registers that version alone.

The orchestrator boots the newest ACTIVE registered image per family and presigns that row's release
files for a droplet that asks (`POST /sandbox/release`, authenticated like `/sandbox/git-token`).

## On the machine

- `oyren version` prints the manifest.
- `oyren update --check` prints one line per changed component and exits 3 when there is something
  to apply.
- `oyren update` asks the orchestrator for the latest release, hands the presigned URLs to the
  root-side updater (`/usr/local/bin/oyren-update`, `deploy/update/`), which re-launches itself in a
  transient systemd unit, verifies the tarball's sha256, version and updater protocol, unpacks it
  beside the installed tree and execs the new tree's `apply-release.sh`. That applies only the
  changed components (host toolchain first, runtime last), stamps each as it lands, swaps the
  composer tree, restarts only the units that changed, and rolls the runtime back if it does not
  answer health within a minute. Progress is in `/etc/oyren/update-status.json`, the log in
  `/var/log/oyren-update.log`, both readable by the sandbox user; the runtime's `update/status`
  control action returns them to the UI, and the updater posts each state change to the
  orchestrator's `/sandbox/update-result`.
- The tmux server runs in its own unit (`oyren-tmux.service`), so the runtime restart keeps every
  shell and the agent running in it.
- `oyren quiesce` is what the orchestrator runs before snapshotting the disk at session end.

## The prompt for an agent

Paste this into the coding agent running in the Codespace (the UI offers it with the versions
filled in):

```
This Codespace runs image <installed version>; the latest is <latest version>. Please update it in place:

1. Run `oyren update --check` and read the component diff it prints (installed → latest).
2. Review the diff: note anything that touches tools this project depends on, and anything I installed by hand.
3. Run `oyren update`. It applies the new image in place and restarts the runtime; the shell survives, but running processes restart, so stop dev servers and watchers first and start them again afterwards.
4. Verify the tools you use still work (git, node, python, and the language servers you rely on) and reinstall anything the update dropped.
5. Report what changed, what you verified, and anything I need to redo by hand.
```

## Contract with the orchestrator

- `POST /sandbox/release` body `{appSlug, controlToken, family?}` → `{version, family, manifestUrl,
  tarballUrl, expiresAt}`; 403 bad pair, 404 no release for the family, 429 over the per-session
  budget, 501 releases not configured.
- `POST /sandbox/update-result` body `{appSlug, controlToken, state, step, from, to, error}` →
  `{ok: true}`; `done` sets the session's image version.
- `POST /sandbox/images` body `{key, version, doImageId, doImageName, region, composerSha?,
  manifestKey?, tarballKey?, tarballSha256?, source?}` → the stored row. Called by the bake workflow,
  not by a machine, and authenticated with `Authorization: Bearer <IMAGE_REGISTRY_TOKEN>` rather than
  a session control token. 201 created, 200 already registered with the same image id, 409 that
  version claimed by a different one, 400 anything DigitalOcean does not confirm (the orchestrator
  re-reads the image's name, type and regions before storing it), 503 no token configured.
- Update step vocabulary: `starting`, `fetching`, `verifying`, `applying:<component>`, `restarting`,
  `done`. The session's status stays `active` throughout.
- The orchestrator's own trigger runs `oyren update --yes --no-wait --json` through the control API
  and polls `update/status`.
