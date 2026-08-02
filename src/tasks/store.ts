import { readFile, writeFile, readdir } from "node:fs/promises";
import type { Task } from "./types.js";
import { metaPath } from "../workspace/paths.js";
import { config } from "../config.js";

const tasks = new Map<string, Task>();

/** Persist a task's metadata to disk (write-through) and cache it in memory. */
export async function saveTask(task: Task): Promise<void> {
  tasks.set(task.id, task);
  await writeFile(metaPath(task.id), JSON.stringify(task, null, 2));
}

export function getTask(id: string): Task | undefined {
  return tasks.get(id);
}

/** In-memory-only liveness bump; avoids a disk write per output chunk. */
export function touchOutput(id: string): void {
  const t = tasks.get(id);
  if (t) t.lastOutputAt = Date.now();
}

export function allTasks(): Task[] {
  return [...tasks.values()];
}

export function dropTask(id: string): void {
  tasks.delete(id);
}

/** Apply a partial update to a task and persist it. */
export async function patchTask(id: string, patch: Partial<Task>): Promise<Task | undefined> {
  const current = tasks.get(id);
  if (!current) return undefined;
  const next = { ...current, ...patch };
  await saveTask(next);
  return next;
}

/** Load persisted meta.json files back into memory (called on boot). */
export async function rehydrate(): Promise<Task[]> {
  let ids: string[];
  try {
    ids = await readdir(config.tasksDir);
  } catch {
    return [];
  }
  const loaded: Task[] = [];
  for (const id of ids) {
    try {
      const task = JSON.parse(await readFile(metaPath(id), "utf8")) as Task;
      tasks.set(task.id, task);
      loaded.push(task);
    } catch {
      // skip dirs without a valid meta.json
    }
  }
  return loaded;
}
