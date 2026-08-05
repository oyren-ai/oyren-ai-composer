# The Oyren Editor

openvscode-server, rebranded, with an agent picker in its terminal and GitHub Copilot removed.

Everything needed to reproduce it lives in this directory and is plain shell + JSON — no build step,
no bundler, no fork of VS Code. That is deliberate: the same scripts run in our snapshot bake and on
someone else's server, so a self-hosted install is the *same* editor rather than an approximation.

## Install

```bash
sudo ./install-editor.sh                 # server + branding + our extensions
sudo ../sandbox-host/install-workspace-dir.sh   # the folder it opens
```

| Env | Default | |
|---|---|---|
| `OPENVSCODE_VERSION` | `1.109.5` | Pinned. Bump deliberately: proposed APIs move between versions. |
| `EDITOR_USER` | `oyren` | Owns and runs the server. Created if missing. |
| `INSTALL_DIR` | `/opt/openvscode-server` | |
| `INSTALL_CLAUDE_EXTENSION` | `1` | Anthropic's extension, from Open VSX. |
| `INSTALL_CHAT_PROBE` | `1` | Throwaway spike — set `0` for a real install. |

Then run it with `../sandbox-host/start-editor.mjs`, or the `oyren-editor.service` unit in
`../units/`.

| Env | Default | |
|---|---|---|
| `OYREN_EDITOR_PORT` | `3131` | Binds `127.0.0.1` only — put a proxy in front. |
| `OYREN_WORKSPACE_DIR` | `/home/oyren/workspace` | The folder the editor opens. |
| `OYREN_EDITOR_BASE_PATH` | `/_oyren/ide/$SESSION_TOKEN` | See below. |
| `OYREN_EDITOR` | — | `0` disables the editor entirely (small tiers). |

## Authorisation is the one thing you must decide

By default the server refuses to start without `SESSION_TOKEN`, and serves under
`/_oyren/ide/<token>/`. The token is in the **path** because openvscode derives every asset and
WebSocket URL from `--server-base-path`: a query parameter is dropped by those, and a cookie is
third-party inside an iframe. So the path *is* the credential.

Self-hosting behind your own authenticating proxy, set `OYREN_EDITOR_BASE_PATH` (e.g. `/ide`, or
empty to serve at the root). That waives the token check — **your proxy is then the only thing
between the internet and a root-capable IDE with an integrated terminal.** Do not expose port 3131.

## Copilot is removed, not merely absent

openvscode-server ships no Copilot extension. But `product.json` carries `defaultChatAgent`, added
upstream between 1.105 and 1.106, and it makes the workbench advertise a Copilot that cannot exist —
setup prompts, GitHub sign-in, entitlement checks (gitpod-io/openvscode-server#643).

`product.overrides.json` deletes it, along with `trustedExtensionAuthAccess`. A `null` in that file
means *delete the key*, not *set it to null*: several workbench checks test for presence.

`extensionsGallery` is deliberately left pointing at **Open VSX**. Pointing a non-Microsoft product
at the VS Code Marketplace violates its terms of use, so do not "fix" that.

## The agent picker

`machine-settings.json` maps the terminal profile dropdown to `oyren-agent-term`. The default
profile attaches to the tmux session named `main`, so the editor terminal and any other terminal
attached to that session show one live conversation. The named profiles start a separate agent, in
its own tmux session, sharing the filesystem but not the conversation.

This needs the agent CLIs on `PATH` (`../sandbox-host/install-agents.sh`) and a launcher at
`/app/agent-launch.sh` — override with `OYREN_AGENT_LAUNCH`.

## oyren-chat-probe

A spike, not a feature. It asks whether a build with no Copilot will render the built-in Chat view
for a third-party participant that declares itself the default — something no published build
appears to do. Read its output in the "Oyren Chat Probe" output channel, then delete the directory
and set `INSTALL_CHAT_PROBE=0`.
