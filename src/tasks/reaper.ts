import { rm } from "node:fs/promises";
import { config } from "../config.js";
import { allTasks, dropTask } from "./store.js";
import { isTerminal } from "./types.js";
import { killTask } from "../runner/kill.js";
import { taskDir } from "../workspace/paths.js";

const INTERVAL_MS = 5000;

async function tick(): Promise<void> {
  const now = Date.now();
  for (const t of allTasks()) {
    if (t.state === "running" && t.startedAt && now - t.startedAt > t.timeoutSeconds * 1000) {
      await killTask(t.id, "timeout");
      continue;
    }
    if (isTerminal(t.state) && t.finishedAt && now - t.finishedAt > config.taskTtlSeconds * 1000) {
      dropTask(t.id);
      await rm(taskDir(t.id), { recursive: true, force: true }).catch(() => {});
    }
  }
}

/** Enforce per-task wall-clock timeouts and garbage-collect expired task dirs. */
export function startReaper(): void {
  setInterval(() => void tick(), INTERVAL_MS).unref();
}
