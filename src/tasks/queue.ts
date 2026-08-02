import { config } from "../config.js";

type Job = () => Promise<void>;

const pending: Job[] = [];
let active = 0;

/** Enqueue a job; runs immediately if a concurrency slot is free, else FIFO-queued. */
export function enqueue(job: Job): void {
  pending.push(job);
  pump();
}

function pump(): void {
  while (active < config.maxConcurrent && pending.length > 0) {
    const job = pending.shift()!;
    active++;
    job()
      .catch(() => {})
      .finally(() => {
        active--;
        pump();
      });
  }
}

export function queueStats(): { active: number; pending: number } {
  return { active, pending: pending.length };
}
