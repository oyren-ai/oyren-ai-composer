import { mkdir } from "node:fs/promises";
import { config } from "./config.js";
import { createApp } from "./http/app.js";
import { recover } from "./tasks/recovery.js";
import { startReaper } from "./tasks/reaper.js";
import { ensureTaskNetwork } from "./runner/network.js";

async function main(): Promise<void> {
  await mkdir(config.tasksDir, { recursive: true });
  await ensureTaskNetwork().catch((e) => console.error("task network setup failed:", e.message));
  await recover();
  startReaper();

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`script-runner MCP listening on :${config.port}`);
  });
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
