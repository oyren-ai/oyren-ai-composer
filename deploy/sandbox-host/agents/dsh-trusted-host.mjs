// Ported from install-agents.sh, where it was a heredoc; a real file so it can be
// node --check-ed and read on its own. ESM, to match the package type.
import fs from "node:fs";
import path from "node:path";
const pnpmRoot = process.argv[2];
// Each row: pnpm package-dir prefix, path under the package's own node_modules, and its
// exact-match replacement pairs. Every physical copy in .pnpm (peer-set variants included) is
// patched; each pair must match exactly once per file unless the replacement is already present
// (rerun-safe).
const targets = [
  {
    prefix: "@deepseek-ai+dsh-client-connection@",
    rel: "@deepseek-ai/dsh-client-connection/lib/index.js",
    pairs: [
      [
        'requestRejection(request) {\n\t\tif (!isTrustedApiRequest(request, this.trustedHosts)) return 403;\n\t\treturn this.browserAuth.isAuthenticated(request) ? void 0 : 401;\n\t}',
        'requestRejection(request) {\n\t\tif (!isTrustedApiRequest(request, this.trustedHosts)) return 403;\n\t\t/* Oyren: the token-gated dsh hostname is the authentication boundary. */\n\t}'
      ],
      [
        'authorizeIndex(request, response) {\n\t\treturn this.browserAuth.authorizeIndex(request, response);\n\t}',
        'authorizeIndex(request, response) {\n\t\tif (isTrustedApiRequest(request, this.trustedHosts)) return true;\n\t\tresponse.writeHead(403, { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" });\n\t\tresponse.end(request.method === "HEAD" ? void 0 : "forbidden\\n");\n\t\treturn false;\n\t}'
      ]
    ]
  },
  {
    prefix: "@deepseek-ai+dsh-client-ui-settings@",
    rel: "@deepseek-ai/dsh-client-ui-settings/lib/client.js",
    pairs: [
      [
        'const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";',
        'const persistence = "host";'
      ]
    ]
  },
  {
    prefix: "@deepseek-ai+dsh-client-ui-settings-general@",
    rel: "@deepseek-ai/dsh-client-ui-settings-general/lib/client.js",
    pairs: [
      [
        'const documentController = ctx.remote.$host.isLoopback ? new SettingsDocumentStore(ctx, ctx.settingsScope.describe()) : void 0;',
        'const documentController = new SettingsDocumentStore(ctx, ctx.settingsScope.describe());'
      ]
    ]
  }
];
let failures = 0;
for (const target of targets) {
  const dirs = fs.readdirSync(pnpmRoot).filter((name) => name.startsWith(target.prefix));
  if (dirs.length === 0) {
    console.error(`ERROR: no ${target.prefix}* package in ${pnpmRoot}`);
    failures += 1;
    continue;
  }
  for (const dir of dirs) {
    const file = path.join(pnpmRoot, dir, "node_modules", target.rel);
    let src;
    try {
      src = fs.readFileSync(file, "utf8");
    } catch (error) {
      console.error(`ERROR: cannot read ${file}: ${error.message}`);
      failures += 1;
      continue;
    }
    let next = src;
    let fileFailures = 0;
    for (const [oldText, newText] of target.pairs) {
      const oldCount = next.split(oldText).length - 1;
      const newCount = next.split(newText).length - 1;
      if (oldCount === 0 && newCount === 1) continue; // already patched — nothing to do
      if (oldCount !== 1 || newCount !== 0) {
        console.error(`ERROR: expected exactly one old or one patched occurrence in ${file}:\n  ${oldText.slice(0, 90)}...`);
        failures += 1;
        fileFailures += 1;
        continue;
      }
      next = next.replace(oldText, newText);
    }
    if (fileFailures === 0) {
      fs.writeFileSync(file, next);
      console.log(`    patched ${path.relative(pnpmRoot, file)}`);
    }
  }
}
if (failures > 0) process.exit(1);
