import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import type { Runtime, Task } from "./types.js";
import { saveTask } from "./store.js";
import { enqueue } from "./queue.js";
import { persistZip } from "../workspace/zip.js";
import { execute } from "../runner/execute.js";

export interface CreateInput {
  runtime: Runtime;
  commandBase64: string;
  zipBase64?: string;
  timeoutSeconds?: number;
  memoryMb?: number;
}

/** Validate input, persist the task + source zip, enqueue it, and return its id. */
export async function createTask(input: CreateInput): Promise<string> {
  const command = Buffer.from(input.commandBase64, "base64").toString("utf8").trim();
  if (!command) throw new Error("command_base64 decoded to an empty string");

  const timeoutSeconds = Math.min(
    Math.max(1, Math.round(input.timeoutSeconds ?? config.defaultTimeoutSeconds)),
    config.maxTimeoutSeconds,
  );
  const memoryMb = Math.min(
    Math.max(64, Math.round(input.memoryMb ?? config.taskDefaultMemoryMb)),
    config.taskMaxMemoryMb,
  );

  const id = randomUUID();
  const task: Task = {
    id,
    runtime: input.runtime,
    command,
    timeoutSeconds,
    memoryMb,
    state: "queued",
    exitCode: null,
    reason: null,
    containerId: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    lastOutputAt: null,
  };

  await persistZip(id, input.zipBase64 ?? EMPTY_ZIP_BASE64);
  await saveTask(task);
  enqueue(() => execute(id));
  return id;
}

// Minimal valid empty zip, used when a caller submits a command with no source.
const EMPTY_ZIP_BASE64 = "UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==";
