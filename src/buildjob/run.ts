import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname } from "node:path";
import { buildEnv } from "./env.js";
import { cloneAtRef } from "./git.js";
import { finish, stdoutPath, stderrPath } from "./state.js";

/** `docker login` with the password over stdin — the credential never hits argv or the logs. */
function dockerLogin(username: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("docker", ["login", "--username", username, "--password-stdin"]);
    p.stdin.end(password);
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`docker login exited ${code}`))));
  });
}

/** Run ./build-and-push-all.sh at the repo root, streaming output to the log files. */
function runBuildScript(): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const p = spawn("bash", ["./build-and-push-all.sh"], { cwd: buildEnv.repoDir });
    p.stdout.pipe(createWriteStream(stdoutPath));
    p.stderr.pipe(createWriteStream(stderrPath));
    p.on("error", reject);
    p.on("close", (code) => resolve(code));
  });
}

/** The once-per-boot build job: clone → docker login → build-and-push-all.sh → record outcome.
 *  Never rethrows — every outcome lands in the /status state the caller is polling. */
export async function runBuildJob(): Promise<void> {
  try {
    await mkdir(buildEnv.logsDir, { recursive: true });
    await mkdir(dirname(buildEnv.repoDir), { recursive: true });
    console.log(`cloning ${buildEnv.gitUrl} @ ${buildEnv.gitRef}`);
    await cloneAtRef(buildEnv.gitUrl, buildEnv.gitRef, buildEnv.gitToken, buildEnv.repoDir);
    await dockerLogin(buildEnv.dockerUsername, buildEnv.dockerPassword);
    console.log("running ./build-and-push-all.sh");
    const code = await runBuildScript();
    finish(code === 0 ? "succeeded" : "failed", code);
    console.log(`build job finished (exit=${code})`);
  } catch (err) {
    finish("failed", null);
    console.error(`build job failed: ${(err as Error).message}`);
  }
}
