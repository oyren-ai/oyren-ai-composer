---
name: proxy-routes
description: Manage the container's reverse proxy routes — map URL prefixes to internal ports so multiple services are accessible through the single public URL.
---

# Reverse Proxy Routes

## How it works

The Oyren sandbox exposes ONE port to the outside world (port 8080, mapped to the container's
public HTTPS URL by DigitalOcean App Platform). A built-in reverse proxy routes incoming
requests to internal services based on URL path prefixes.

```
Public URL (HTTPS)
  └─→ Container :8080 (Node.js server)
        ├── /_oyren/health        → health check (always 200)
        ├── /_oyren/control/*     → control API (auth required)
        ├── /_oyren/download      → file downloads from /workspace/.oyren-deliver/
        ├── /_oyren/gateway       → gateway landing page (always available)
        ├── /agent/*              → headless agent chat
        ├── /terminal (WS)       → terminal PTY
        ├── Configured routes     → proxy to internal ports (this skill)
        └── /* (fallback)         → supervisor.exposedPort or gateway page
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

### Programmatic (control API)

```bash
# Add a route
curl -X POST http://127.0.0.1:8080/_oyren/control/route/add \
  -H "x-oyren-control-token: $CONTROL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prefix":"/studio","port":3000,"label":"Remotion Studio"}'

# List routes
curl -X POST http://127.0.0.1:8080/_oyren/control/route/list \
  -H "x-oyren-control-token: $CONTROL_TOKEN"

# Remove a route
curl -X POST http://127.0.0.1:8080/_oyren/control/route/remove \
  -H "x-oyren-control-token: $CONTROL_TOKEN" \
  -d '{"prefix":"/studio"}'
```

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

## Backward compatibility

The old `oyren expose <port>` command still works. It sets the "fallback" port that handles
requests when no configured route matches. Routes and the exposed port coexist:

```bash
# Old way (still works): expose a single default port
oyren expose 3000

# New way: configure routes for multi-service setups
oyren route add / 3000 "Frontend"
oyren route add /api 3001 "Backend"
```

## Gateway page

The gateway page at `/_oyren/gateway` is always accessible — even when a catch-all route is
configured. It shows:
- All configured routes with live TCP status (listening / not listening)
- A download button for files in `/workspace/.oyren-deliver/`
- CLI instructions for managing routes
- A table of reserved endpoints

When no routes are configured AND no port is exposed, the gateway page is shown at `/`.

## Download button

Files staged in `/workspace/.oyren-deliver/` are served at `/_oyren/download`. The gateway
page includes a direct link. All download URLs are **relative** (no hardcoded port), so they
work on any host: `https://app-xxx.ondigitalocean.app`, `http://localhost:8080`, etc.

To stage a file for download:
```bash
mkdir -p /workspace/.oyren-deliver
cp my-output.mp4 /workspace/.oyren-deliver/
```

Then tell the user to visit the gateway page or click the Download button in the panel.
