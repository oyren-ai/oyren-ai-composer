import type Docker from "dockerode";
import { config } from "../config.js";
import type { Runtime } from "../tasks/types.js";
import { docker, imageFor } from "./images.js";
import { workspaceDir } from "../workspace/paths.js";

export interface CreateOpts {
  id: string;
  runtime: Runtime;
  command: string;
  memoryMb: number;
  env: Record<string, string>;
}

/** Create (but do not start) a hardened, disposable task container. */
export async function createTaskContainer(o: CreateOpts): Promise<Docker.Container> {
  const hostWorkspace = workspaceDir(o.id); // same absolute path on host & app container
  return docker.createContainer({
    Image: imageFor(o.runtime),
    Cmd: ["/bin/sh", "-lc", o.command],
    WorkingDir: "/workspace",
    Env: Object.entries(o.env).map(([k, v]) => `${k}=${v}`),
    Labels: { [config.taskLabel]: o.id },
    HostConfig: {
      Binds: [`${hostWorkspace}:/workspace`],
      Memory: o.memoryMb * 1024 * 1024,
      NanoCpus: config.taskNanoCpus,
      PidsLimit: config.taskPidsLimit,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      NetworkMode: config.taskNetwork,
      AutoRemove: false, // keep until exit code is read
    },
  });
}
