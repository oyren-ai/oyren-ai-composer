import { docker } from "./images.js";
import { getTask, patchTask } from "../tasks/store.js";
import { isTerminal } from "../tasks/types.js";

/**
 * Stop a task. If it is running, the container is stopped and the execute loop
 * records the final state (mapping `reason` → killed / timed-out). If it is
 * still queued, it is marked killed directly.
 */
export async function killTask(id: string, reason: string): Promise<boolean> {
  const task = getTask(id);
  if (!task || isTerminal(task.state)) return false;
  await patchTask(id, { reason });

  if (task.containerId) {
    const c = docker.getContainer(task.containerId);
    try {
      await c.stop({ t: 5 });
    } catch {
      try {
        await c.kill();
      } catch {
        // already gone
      }
    }
  } else {
    await patchTask(id, { state: "killed", finishedAt: Date.now() });
  }
  return true;
}
