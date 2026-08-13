---
name: proxy-routes
description: Manage the container's reverse proxy routes — map URL prefixes to internal ports so multiple services are accessible through the single public URL.
---

# Reverse Proxy Routes

## How it works

The Oyren sandbox exposes ONE port to the outside world (port 8080, mapped to the container's
public HTTPS URL). A built-in reverse proxy routes incoming requests to internal services based
on URL path prefixes.

```
Public URL (HTTPS)
  └─→ Container :8080 (Node.js server)
        ├── /_oyren/health                → health check (always 200)
        ├── /_oyren/control/*             → control API (auth required)
        ├── /_oyren/download              → file downloads from /workspace/.oyren-deliver/
        ├── /_oyren/gateway               → gateway landing page (always available)
        ├── /_oyren/port/<token>/<port>/* → session-token-gated proxy to any local port
        ├── /agent/*                      → headless agent chat
        ├── /terminal (WS)               → terminal PTY
        ├── Configured routes             → proxy to internal ports (this skill)
        └── /* (fallback)                 → supervisor.exposedPort or gateway page
```

## Managing routes

### CLI (from the terminal)

```bash
# Add a route: map a URL prefix to an internal port
oyren route add / 3000 "My App"                 # catch-all → port 3000
oyren route add /studio 3000 "Remotion Studio"  # /studio/* → port 3000
oyren route add /api 3001 "API Server"          # /api/* → port 3001

# List all configured routes
oyren route list

# Remove a route
oyren route remove /studio
```

### Direct file edit

Routes are stored in `/workspace/.oyren-routes.json`. You can edit this file directly —
the server watches it and picks up changes automatically (within ~2 seconds):

```json
{
  "routes": [
    { "prefix": "/", "port": 3000, "label": "My App" },
    { "prefix": "/api", "port": 3001, "label": "API Server" }
  ]
}
```

Control-API curl examples, backward compatibility (`oyren expose`), and the download button
are documented in [reference.md](reference.md).

## Route matching

- **Longest prefix wins**: `/api/v2/users` matches `/api/v2` before `/api` before `/`.
- **Prefix stripping**: the matched prefix is stripped before forwarding. `/studio/bundle.js`
  is forwarded as `/bundle.js` to the target port. The root prefix `/` does NOT strip.
- **Fallback**: if no route matches, the request goes to `supervisor.exposedPort` (set via
  `oyren expose <port>`). If that's also unset, the gateway landing page is shown.
- **Reserved paths** (`/_oyren/*`, `/agent/*`, `/terminal`, `/how-to-deploy`) are NEVER
  proxied — they always reach the built-in handlers regardless of route config.
- **WebSockets**: route matching also applies to WebSocket upgrades, so apps like Remotion
  Studio (which use WS for hot-reload) work through the proxy.

## Port proxy vs routes

`http://localhost:<port>` NEVER works for the user — localhost in their browser is THEIR
machine, not this container. Every URL you share must be on the session origin. Two ways:

- **A route** (preferred, shareable): `oyren route add /app 3000` serves the app at
  `<session-origin>/app/` — clean paths, no token in the URL.
- **The port proxy** (ad-hoc, token-gated): any local port is reachable with no route at
  `<session-origin>/_oyren/port/<SESSION_TOKEN>/<port>/` — this is what the editor's Oyren
  Preview uses. HTTP and WebSocket upgrades both pass through; the `/_oyren/port/<token>/<port>`
  prefix is stripped (query preserved), and a bare `…/<port>` 302s to `…/<port>/`.
  Wrong or missing token → 401; nothing listening on the port → 502.

Both are pure prefix proxies: an app that emits absolute asset paths (`/static/app.js`)
escapes the prefix and 404s — it needs a configured base path, or a `/` route.

## Gateway page

The gateway page at `/_oyren/gateway` is always accessible — even when a catch-all route is
configured. It shows all configured routes with live TCP status, a download button, CLI
instructions, and a table of reserved endpoints. When no routes are configured AND no port
is exposed, the gateway page is shown at `/`.
