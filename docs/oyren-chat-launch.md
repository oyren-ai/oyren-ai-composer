# Launching agents from the editor's Chat view

Extends `oyren-chat-participant.md`. The Chat view's default participant talks to THIS session's
agent. This document covers the second verb: picking a DIFFERENT agent and launching it with your
message as its first task.

## Why launch, not switch

A session runs exactly one agent engine, chosen at boot (`AGENT_KIND` → `engineSelect.js` at require
time). "Switching to cursor" mid-session would mean tearing down and rebooting the engine under a
live conversation — the runtime cannot do it and should not pretend to. What the platform CAN do,
today, is spawn a sibling: the orchestrator's MCP `launch_agent` tool
(`adapter/inbound/mcp/handlers/launchHandlers.ts`) launches a child container that inherits the
caller's persisted config — repos, workspace, size, chatbot context — with a chosen `agentKind` and
a first `prompt`. So agent selection in chat maps to LAUNCH: same repo, fresh agent, your message
already delivered.

## Surface: slash commands, one per agent

```
/opencode fix the failing tests        ← launches opencode, message = "fix the failing tests"
/cursor …   /codex …   /claude …   /gemini …   /qwen …   /antigravity …
(no command)                           ← talks to this session's own agent, streamed live
```

Slash commands rather than extra participants or picker entries because they are a STABLE part of
the `chatParticipants` contribution (no proposed API), they show up in the `/` autocomplete with a
description — which is the discoverability the dropdown was wanted for — and the argument text is
naturally the first message. The model picker stays what it is: the session engine's models.

## Mechanics (extension side)

1. The extension host inherits the full session env (verified live). `OYREN_MCP_SERVERS` is a JSON
   array of `{name, url, token?}` — the same connections seeded into the agent's own MCP config by
   `seedMcpServers.js`. Find the oyren runtime server entry.
2. Call `tools/call launch_agent` over MCP streamable HTTP with
   `{fromSession: env.OYREN_SESSION_UUID, agentKind: <from the command>, prompt: <the message>}`.
   The orchestrator authorises against the caller's session and enforces the launch-depth limit.
3. Render the result as markdown: the child's session id linked to `oyren.ai/session/<id>`, or the
   handler's own error text (it is written for a model to correct from, which reads fine to humans).
4. `OYREN_MCP_SERVERS` absent (self-hosted editor, MCP-less launch): the commands still register but
   reply with one sentence saying launching is not wired in this environment.

## Chatbots

A child launch inherits the calling session's chatbot context via the persisted replay config
(`chatbotUuid` — see CreateTerminalInput's replay fields): launch from a session seeded with a
custom agent and the child gets the same character. Choosing a DIFFERENT chatbot per launch is not
in `launch_agent`'s schema today; if that is wanted, the schema grows a `chatbotUuid` field on the
orchestrator side first — the extension then just passes it through.

## Billing honesty

Every launch is a paid container (credit hold at launch, per-minute billing). The command
description must say "launches a new session" — a user typing `/cursor` should never discover the
charge from the invoice.
