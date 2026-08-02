import { join } from "node:path";
import { config } from "../config.js";

export function taskDir(id: string): string {
  return join(config.tasksDir, id);
}

export function workspaceDir(id: string): string {
  return join(taskDir(id), "workspace");
}

export function zipPath(id: string): string {
  return join(taskDir(id), "source.zip");
}

export function metaPath(id: string): string {
  return join(taskDir(id), "meta.json");
}

export function stdoutPath(id: string): string {
  return join(taskDir(id), "stdout.log");
}

export function stderrPath(id: string): string {
  return join(taskDir(id), "stderr.log");
}
