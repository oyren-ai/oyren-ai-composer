/** Shared env-var readers for the per-lane env loaders (same contract as src/config.ts's
 *  private helpers; extracted so the VM lanes don't have to import the MCP config,
 *  which throws without SCRIPT_RUNNER_TOKEN). */

export function str(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Env var ${name} must be a number`);
  return n;
}
