import { test } from "node:test";
import assert from "node:assert/strict";
import { authedUrl, scrub } from "./git.js";

test("authedUrl injects x-access-token auth into https URLs", () => {
  assert.equal(
    authedUrl("https://github.com/o/r.git", "tok123"),
    "https://x-access-token:tok123@github.com/o/r.git",
  );
});

test("authedUrl leaves the URL alone without a token or for non-https", () => {
  assert.equal(authedUrl("https://github.com/o/r.git", ""), "https://github.com/o/r.git");
  assert.equal(authedUrl("git@github.com:o/r.git", "tok"), "git@github.com:o/r.git");
});

test("scrub redacts every occurrence of the token", () => {
  assert.equal(scrub("clone https://x:tok@h failed tok", "tok"), "clone https://x:***@h failed ***");
  assert.equal(scrub("no secret here", ""), "no secret here");
});
