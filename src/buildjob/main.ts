import express from "express";
import { buildEnv } from "./env.js";
import { bearerAuth } from "../util/bearer.js";
import { statusSnapshot } from "./state.js";
import { runBuildJob } from "./run.js";

/** Build-mode entrypoint (systemd: oyren-build.service). Starts the status server, then runs
 *  the build job ONCE. The process stays up afterward so the caller can read the final status;
 *  the caller — not the VM — decides when to delete it. */
const app = express();

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});
app.get("/status", bearerAuth(buildEnv.statusToken), (_req, res) => {
  statusSnapshot()
    .then((s) => res.json(s))
    .catch(() => res.status(500).json({ error: "internal_error" }));
});

app.listen(buildEnv.port, () => {
  console.log(`build status server on :${buildEnv.port}`);
  void runBuildJob();
});
