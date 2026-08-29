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
        '* privileged methods additionally pass it with an empty trust list, which\n* pins them to loopback.',
        '* privileged methods additionally pass the fence a second time against the\n* declared `trustedHosts` (loopback plus this deployment\'s authorities), so\n* the configuration plane stays closed to anonymous callers while remaining\n* usable through an authenticated edge proxy that forwards the declared\n* Host/Origin pair (Oyren sandbox deployment: the router token-gates the dsh\n* hostname before proxying).'
      ],
      [
        'if (method !== void 0 && PRIVILEGED_METHODS.has(method) && !isTrustedApiRequest(request, [])) return new Response("forbidden", { status: 403 });',
        'if (method !== void 0 && PRIVILEGED_METHODS.has(method) && !isTrustedApiRequest(request, trustedHosts)) return new Response("forbidden", { status: 403 });'
      ]
    ]
  },
  {
    prefix: "@deepseek-ai+dsh-client-ui-settings@",
    rel: "@deepseek-ai/dsh-client-ui-settings/lib/client.js",
    pairs: [
      [
        'const mirror = new SettingsDescribeMirror(connection.api, connection.isLoopback ? "host" : "memory");',
        'const mirror = new SettingsDescribeMirror(connection.api, "host");'
      ],
      [
        'const controller = new SettingsScopeController(connection.api, spec, this.mirror, connection.isLoopback ? "host" : "memory", this.schema);',
        'const controller = new SettingsScopeController(connection.api, spec, this.mirror, "host", this.schema);'
      ]
    ]
  },
  {
    prefix: "@deepseek-ai+dsh-client-ui-settings-general@",
    rel: "@deepseek-ai/dsh-client-ui-settings-general/lib/client.js",
    pairs: [
      [
        'const documentController = connection.isLoopback ? new SettingsDocumentStore(connection.api, ctx.settingsScope.describe()) : void 0;',
        'const documentController = new SettingsDocumentStore(connection.api, ctx.settingsScope.describe());'
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
    for (const [oldText, newText] of target.pairs) {
      if (src.includes(newText)) continue; // already patched — nothing to do
      const parts = src.split(oldText);
      if (parts.length !== 2) {
        console.error(`ERROR: expected exactly one occurrence of the pattern in ${file}:\n  ${oldText.slice(0, 90)}...`);
        failures += 1;
        continue;
      }
      src = parts.join(newText);
    }
    fs.writeFileSync(file, src);
    console.log(`    patched ${path.relative(pnpmRoot, file)}`);
  }
}
if (failures > 0) process.exit(1);
