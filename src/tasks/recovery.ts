import { config } from "../config.js";
import { docker } from "../runner/images.js";
import { rehydrate, patchTask } from "./store.js";
import { isTerminal } from "./types.js";

/**
 * On boot: reload persisted tasks, mark any that were mid-flight as killed
 * (their containers are gone or about to be), and remove orphaned task containers.
 */
export async function recover(): Promise<void> {
  const tasks = await rehydrate();
  for (const t of tasks) {
    if (!isTerminal(t.state)) {
      await patchTask(t.id, {
        state: "killed",
        reason: "service-restart",
        finishedAt: Date.now(),
      });
    }
  }

  try {
    const containers = await docker.listContainers({
      all: true,
      filters: { label: [config.taskLabel] },
    });
    for (const c of containers) {
      try {
        await docker.getContainer(c.Id).remove({ force: true });
      } catch {
        // already gone
      }
    }
  } catch {
    // docker unavailable; nothing to reap
  }
}
