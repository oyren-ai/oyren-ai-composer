import Docker from "dockerode";

export const docker = new Docker();

export const CONTAINER_NAME = "oyren-sandbox";

/** Pull the image unconditionally (boot-time only), so a :latest tag is fresh, not cached. */
export async function pullImage(image: string): Promise<void> {
  const stream = await docker.pull(image);
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve()));
  });
}

/** Remove a stale `oyren-sandbox` container left by a previous boot (idempotent). */
export async function removeStale(): Promise<void> {
  try {
    await docker.getContainer(CONTAINER_NAME).remove({ force: true });
  } catch {
    // not present — the healthy path
  }
}

/** Create (but do not start) the single long-lived sandbox container. Trusted lane: the VM
 *  itself is the isolation boundary, so no CapDrop / no-new-privileges here (the workload needs
 *  sudo, package installs, etc.). */
export function createSandboxContainer(image: string, port: number, env: string[]): Promise<Docker.Container> {
  const portKey = `${port}/tcp`;
  return docker.createContainer({
    name: CONTAINER_NAME,
    Image: image,
    Env: env,
    ExposedPorts: { [portKey]: {} },
    HostConfig: {
      PortBindings: { [portKey]: [{ HostIp: "0.0.0.0", HostPort: String(port) }] },
      // Supervision (restart + logging) lives in supervise.ts, not the docker daemon.
      RestartPolicy: { Name: "no" },
    },
  });
}

/** Last `tail` lines of the container's stderr, for the crash breadcrumb. */
export async function stderrTail(container: Docker.Container, tail: number): Promise<string> {
  try {
    const buf = await container.logs({ stderr: true, stdout: false, tail });
    return buf.toString("utf8");
  } catch {
    return "";
  }
}
