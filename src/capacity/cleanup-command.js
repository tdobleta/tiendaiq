"use strict";

const RUN_ID = /^[a-f0-9]{12}$/;

function parseCleanupCommand(value) {
  const runId = String(value?.runId || "").trim().toLowerCase();
  const tenants = Number(value?.tenants);
  if (!RUN_ID.test(runId)) throw new TypeError("runId invalido");
  if (!Number.isInteger(tenants) || tenants < 1 || tenants > 2000) {
    throw new TypeError("tenants invalido");
  }
  return Object.freeze({ runId, tenants, prefix: `capacity-${runId}` });
}

function createCapacityCleanupHandler({ deleteJobs } = {}) {
  if (typeof deleteJobs !== "function") throw new TypeError("El handler requiere deleteJobs");
  return Object.freeze({
    needsCompensation() {
      return false;
    },
    async run(job, { workerId } = {}) {
      const command = parseCleanupCommand(job.payload);
      const jobsDeleted = await deleteJobs(command.prefix, workerId);
      if (!Number.isInteger(jobsDeleted) || jobsDeleted < 0) {
        const error = new Error("El cleanup devolvio un resultado invalido");
        error.nonRetryable = true;
        throw error;
      }
      return { mode: "cleanup", runId: command.runId, tenants: command.tenants, jobsDeleted };
    }
  });
}

module.exports = { parseCleanupCommand, createCapacityCleanupHandler };
