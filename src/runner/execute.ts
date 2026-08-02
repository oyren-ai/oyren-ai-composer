import { extractZip } from "../workspace/zip.js";
import { getTask, patchTask, touchOutput } from "../tasks/store.js";
import { isTerminal, type TaskState } from "../tasks/types.js";
import { createTaskContainer } from "./container.js";
import { captureLogs } from "./logs.js";
import { docker, ensureImage, imageFor } from "./images.js";

function finalState(reason: string | null, code: number): TaskState {
  if (reason === "timeout") return "timed-out";
  if (reason === "oom") return "failed";
  if (reason) return "killed";
  return code === 0 ? "succeeded" : "failed";
}

/** Full lifecycle of one task: extract → run container → record result. */
export async function execute(id: string): Promise<void> {
  const task = getTask(id);
  if (!task || isTerminal(task.state)) return; // killed while queued

  const now = Date.now();
  await patchTask(id, { state: "running", startedAt: now, lastOutputAt: now });

  let containerId: string | null = null;
  try {
    await extractZip(id);
    await ensureImage(imageFor(task.runtime));
    const container = await createTaskContainer({
      id,
      runtime: task.runtime,
      command: task.command,
      memoryMb: task.memoryMb,
      env: {},
    });
    containerId = container.id;
    await patchTask(id, { containerId });

    const logs = captureLogs(container, id, () => touchOutput(id));
    await container.start();
    const [wait] = await Promise.all([container.wait(), logs]);

    const oom = (await container.inspect().catch(() => null))?.State?.OOMKilled === true;
    const reason = getTask(id)?.reason ?? (oom ? "oom" : null);
    await patchTask(id, {
      state: finalState(reason, wait.StatusCode),
      exitCode: wait.StatusCode,
      reason,
      finishedAt: Date.now(),
    });
  } catch (err) {
    await patchTask(id, {
      state: "failed",
      finishedAt: Date.now(),
      reason: (err as Error).message.slice(0, 200),
    });
  } finally {
    if (containerId) {
      try {
        await docker.getContainer(containerId).remove({ force: true });
      } catch {
        // best-effort; reaper is the backstop
      }
    }
  }
}
