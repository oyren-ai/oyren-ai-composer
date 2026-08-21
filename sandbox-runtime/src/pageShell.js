// The one document shell behind every page the runtime serves about itself — the gateway
// (gateway.js) and the log viewer (logs.js). Each used to carry its own copy of a <head> with a
// hard-coded dark palette and a `min-height: 100vh` landing-page layout, which is a black slab
// inside the Oyren app's header popover (~560×384, light-themed for most users). One shell instead:
// theme-aware through CSS variables under `prefers-color-scheme`, compact enough to be embedded,
// and inline-only (no external CSS/JS) so it renders with no internet and no build step.
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))

// Light is the base; dark redefines only the tokens. The violet accents are the page's identity.
const CSS = `
    :root {
      color-scheme: light dark;
      --bg: #fafafa; --fg: #18181b; --muted: #52525b; --faint: #71717a;
      --card: #ffffff; --border: #e4e4e7; --hover: rgba(0,0,0,0.03);
      --accent: #6d28d9; --link: #4f46e5; --code-bg: #f4f4f5; --code-fg: #3730a3;
      --btn-bg: #6366f1; --btn-fg: #ffffff; --btn2-bg: #f4f4f5; --btn2-fg: #5b21b6; --btn2-border: #e4e4e7;
      --ok: #15803d; --bad: #b91c1c;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0a0a12; --fg: #e4e4eb; --muted: #a1a1aa; --faint: #71717a;
        --card: rgba(18,18,28,0.8); --border: #1e1e2e; --hover: rgba(255,255,255,0.02);
        --accent: #c4b5fd; --link: #93c5fd; --code-bg: #0c0c14; --code-fg: #c4d0ff;
        --btn-bg: #6366f1; --btn-fg: #ffffff; --btn2-bg: #1e1e2e; --btn2-fg: #c4b5fd; --btn2-border: #2e2e3e;
        --ok: #4ade80; --bad: #f87171;
      }
    }
    * { box-sizing: border-box; margin: 0; }
    body {
      background: var(--bg); color: var(--fg); padding: 16px;
      font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    }
    main { max-width: 760px; margin: 0 auto; }
    h1 { font-size: 20px; letter-spacing: -0.3px; margin-bottom: 4px; }
    h2 { font-size: 14px; margin-bottom: 8px; color: var(--accent); }
    .sub { color: var(--muted); margin-bottom: 14px; }
    .muted { color: var(--muted); font-size: 13px; }
    .help { color: var(--faint); font-size: 12.5px; margin-top: 8px; line-height: 1.6; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 6px 10px; color: var(--faint); font-weight: 500; border-bottom: 1px solid var(--border); }
    td { padding: 6px 10px; vertical-align: top; }
    tr:hover { background: var(--hover); }
    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .ok { color: var(--ok); } .bad { color: var(--bad); } .dim { color: var(--faint); }
    .num { font-variant-numeric: tabular-nums; }
    .btn { display: inline-block; padding: 7px 14px; border-radius: 8px; font-size: 13px; font-weight: 500; }
    .btn:hover { text-decoration: none; filter: brightness(1.08); }
    .btn-primary { background: var(--btn-bg); color: var(--btn-fg); }
    .btn-secondary { background: var(--btn2-bg); color: var(--btn2-fg); border: 1px solid var(--btn2-border); }
    pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--code-fg); font-size: 12.5px; }
    pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px; overflow-x: auto; margin-top: 8px; }
`

/** Wrap `body` (HTML the caller already escaped) in the shared shell. `extraCss` and `script` are
 *  the page's own additions, inlined so the page stays self-contained. */
function renderPage({ title, body, extraCss = "", script = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${CSS}${extraCss}
  </style>
</head>
<body>
${body}${script ? `\n  <script>\n${script}\n  </script>` : ""}
</body>
</html>`
}

module.exports = { renderPage, escapeHtml }
