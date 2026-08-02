import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeContainerEnv } from "./containerEnv.js";

const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString("base64");

test("empty input decodes to no env", () => {
  assert.deepEqual(decodeContainerEnv(""), []);
});

test("object decodes to KEY=value pairs", () => {
  assert.deepEqual(decodeContainerEnv(b64({ A: "1", B: "x y" })), ["A=1", "B=x y"]);
});

test("non-object JSON is rejected", () => {
  assert.throws(() => decodeContainerEnv(b64(["A=1"])), /must decode to a JSON object/);
  assert.throws(() => decodeContainerEnv(b64(null)), /must decode to a JSON object/);
});
