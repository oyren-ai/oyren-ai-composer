import { sandboxEnv } from "./env.js";
import { decodeContainerEnv } from "./containerEnv.js";
import { pullImage } from "./docker.js";
import { superviseForever } from "./supervise.js";

/** Sandbox-mode entrypoint (systemd: oyren-sandbox.service). One VM, one long-lived *  container, supervised until the VM is destroyed. */
async function main(): Promise<never> {
  const env = decodeContainerEnv(sandboxEnv.containerEnvB64);
  console.log(`pulling ${sandboxEnv.image}...`);
  await pullImage(sandboxEnv.image);
  return superviseForever(sandboxEnv.image, sandboxEnv.containerPort, env);
}

main().catch((err) => {
  console.error(`sandbox mode fatal: ${(err as Error).message}`);
  process.exit(1);
});
