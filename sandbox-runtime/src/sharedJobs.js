// The ONE process-wide detached-run registry. Both the control API (`/_oyren/control/run` +
// `run_result`, CONTROL_TOKEN — used by the orchestrator's run_script tool) and the browser-facing
// runs panel (`/_oyren/runs`, SESSION_TOKEN — see runs.js) must read/write the SAME registry, or the
// panel would never see the orchestrator's runs. Extracted here so there is exactly one instance.
const { createRunJobs } = require("./runJobs")

const jobs = createRunJobs()

module.exports = { jobs }
