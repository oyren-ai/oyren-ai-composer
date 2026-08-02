export const RUNTIMES = ["node24", "python3.8", "python3.13"] as const;
export type Runtime = (typeof RUNTIMES)[number];

export type TaskState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "killed"
  | "timed-out";

export const TERMINAL_STATES: readonly TaskState[] = [
  "succeeded",
  "failed",
  "killed",
  "timed-out",
];

export interface Task {
  id: string;
  runtime: Runtime;
  command: string; // decoded shell one-liner
  timeoutSeconds: number;
  memoryMb: number;
  state: TaskState;
  exitCode: number | null;
  reason: string | null; // e.g. "timeout", "idle", "service-restart"
  containerId: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  lastOutputAt: number | null;
}

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.includes(state);
}
