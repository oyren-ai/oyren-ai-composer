import { str, num } from "../util/env.js";

/** Sandbox-mode config, from /etc/oyren/sandbox.env (written by the VM's cloud-init). */
export const sandboxEnv = {
  /** The image this VM runs. */
  image: str("SANDBOX_IMAGE"),
  /** Port the container listens on; published as port:port on 0.0.0.0 (the VM is VPC-private). */
  containerPort: num("CONTAINER_PORT", 8080),
  /** Base64 of a JSON object of container env vars (includes secrets — cloud-init is the
   *  delivery channel; the value never appears in any API response or log). */
  containerEnvB64: process.env.CONTAINER_ENV_B64 ?? "",
} as const;
