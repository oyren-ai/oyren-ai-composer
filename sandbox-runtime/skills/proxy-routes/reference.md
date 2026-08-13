# Reverse Proxy Routes — reference

Companion to [SKILL.md](SKILL.md): the control-API calls, backward compatibility, and downloads.

## Programmatic (control API)

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

`route/list` answers `{"routes":[…]}` and — when the sandbox knows its public origin — an extra
`"origin": "https://<session-host>"`. The key's PRESENCE is the capability probe for the
`/_oyren/port` proxy: when it is absent, session-origin port-proxy URLs cannot be built here.

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
