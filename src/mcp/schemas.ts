import { z } from "zod";
import { RUNTIMES } from "../tasks/types.js";

export const runScriptShape = {
  runtime: z
    .enum(RUNTIMES)
    .describe("Container runtime: node24, python3.8, or python3.13."),
  command_base64: z
    .string()
    .min(1)
    .describe("Base64 of the shell one-liner to run in /workspace (e.g. 'node main.js')."),
  zip_base64: z
    .string()
    .optional()
    .describe("Base64 of a zip of the source tree, extracted into /workspace. Omit for no files."),
  timeout_seconds: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Hard wall-clock limit before the task is killed. Default 300, capped by server."),
  memory_mb: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Container memory cap in MB. Default 4096; may be raised to 8192 if needed."),
} as const;

export const getStatusShape = {
  task_id: z.string().describe("UUID returned by run_script."),
  tail_bytes: z
    .number()
    .int()
    .positive()
    .max(10000)
    .optional()
    .describe("Bytes of stdout/stderr tail to return (default 2000, max 10000)."),
} as const;

export const killShape = {
  task_id: z.string().describe("UUID of the task to stop."),
} as const;
