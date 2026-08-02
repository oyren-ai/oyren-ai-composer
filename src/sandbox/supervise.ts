import { setTimeout as sleep } from "node:timers/promises";
import { createSandboxContainer, removeStale, stderrTail } from "./docker.js";

const RESTART_DELAY_MS = 2_000;
const STDERR_TAIL_LINES = 50;

/** Run the sandbox container forever: create → start → wait → log exit + stderr tail →
 *  2s cooldown → re-run. The container-level twin of agent-launch.sh's CLI restart loop —
 *  a crashed container comes back on its own instead of leaving a dead VM.
 *  Runs until the VM is destroyed (systemd stops the service with the machine). */
export async function superviseForever(image: string, port: number, env: string[]): Promise<never> {
  for (;;) {
    await removeStale();
    try {
      const container = await createSandboxContainer(image, port, env);
      await container.start();
      console.log(`sandbox container started (image=${image}, port=${port})`);
      const { StatusCode } = (await container.wait()) as { StatusCode: number };
      const tail = await stderrTail(container, STDERR_TAIL_LINES);
      console.error(`sandbox container exited (code=${StatusCode})`);
      if (tail) console.error(`--- last stderr ---\n${tail}`);
    } catch (err) {
      // create/start failure (e.g. dockerd mid-boot) — same cooldown, then retry.
      console.error(`sandbox container failed to run: ${(err as Error).message}`);
    }
    console.log(`restarting in ${RESTART_DELAY_MS / 1000}s...`);
    await sleep(RESTART_DELAY_MS);
  }
}
