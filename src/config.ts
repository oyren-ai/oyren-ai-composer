import { resolve } from "node:path";

function str(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Env var ${name} must be a number`);
  return n;
}

export const config = {
  port: num("PORT", 3000),
  token: str("SCRIPT_RUNNER_TOKEN"),
  tasksDir: resolve(str("TASKS_DIR", "/srv/script-runner/tasks")),
  maxConcurrent: num("MAX_CONCURRENT", 8),
  defaultTimeoutSeconds: num("DEFAULT_TIMEOUT_SECONDS", 300),
  maxTimeoutSeconds: num("MAX_TIMEOUT_SECONDS", 1800),
  maxZipBytes: num("MAX_ZIP_MB", 25) * 1024 * 1024,
  taskDefaultMemoryMb: num("TASK_MEMORY_MB", 4096),
  taskMaxMemoryMb: num("TASK_MAX_MEMORY_MB", 8192),
  taskNanoCpus: Math.round(num("TASK_CPUS", 2) * 1e9),
  taskPidsLimit: num("TASK_PIDS_LIMIT", 256),
  taskNetwork: str("TASK_NETWORK", "script-runner-tasks"),
  taskTtlSeconds: num("TASK_TTL_SECONDS", 86400),
  taskLabel: "oyren.script-runner.task",
} as const;
