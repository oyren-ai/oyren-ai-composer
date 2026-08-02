import { str, num } from "../util/env.js";

/** Build-mode config, from /etc/oyren/build.env (written by the VM's cloud-init).
 *  DOCKER_* are the TRIGGERING PERSON's Docker Hub credentials (ideally an access token),
 *  supplied per launch — never baked into the snapshot, never logged. */
export const buildEnv = {
  gitUrl: str("GIT_URL", "https://github.com/oyren-ai/oyren-ai-deployable-containers.git"),
  gitRef: str("GIT_REF", "main"),
  /** Optional token for a private clone (https token auth); empty ⇒ anonymous. */
  gitToken: process.env.GIT_TOKEN ?? "",
  dockerUsername: str("DOCKER_USERNAME"),
  dockerPassword: str("DOCKER_PASSWORD"),
  /** Bearer token the caller polls GET /status with. */
  statusToken: str("STATUS_TOKEN"),
  port: num("PORT", 3000),
  repoDir: str("REPO_DIR", "/srv/oyren-build/repo"),
  logsDir: str("LOGS_DIR", "/srv/oyren-build/logs"),
} as const;
