"use strict";

const RUN_ID = /^[a-f0-9]{12}$/;

function parseCleanupCommand(value) {
  const runId = String(value?.runId || "").trim().toLowerCase();
  const tenants = Number(value?.tenants);
  if (!RUN_ID.test(runId)) throw new TypeError("runId invalido");
  if (!Number.isInteger(tenants) || tenants < 1 || tenants > 2000) {
    throw new TypeError("tenants invalido");
  }
  const prefix = `capacity-${runId}`;
  // El job durable vive en el tenant 1. Nunca puede borrarlo el worker antes
  // de que el runner haya persistido su resultado, porque perdería su propio
  // lease/evidencia. La web elimina ese único tenant final después de observar
  // el éxito durable del job.
  return Object.freeze({
    runId,
    tenants,
    prefix,
    anchorIndex: 1,
    anchorDomain: `${prefix}-1.myshopify.com`
  });
}

function syntheticTenantDomain(command, index) {
  if (!Number.isInteger(index) || index < 1 || index > command.tenants) {
    throw new RangeError("indice de tenant sintetico invalido");
  }
  return `${command.prefix}-${index}.myshopify.com`;
}

// An interrupted legacy cleanup may have removed the sole tenant that holds
// the durable cleanup job. Recreate only that derived, synthetic anchor before
// enqueueing. The caller supplies the persistence operations so this boundary
// remains independently testable and cannot create an arbitrary tenant.
async function ensureSyntheticCleanupAnchor(command, { readStore, saveStore } = {}) {
  if (!command || typeof command.anchorDomain !== "string" || !RUN_ID.test(command.runId)) {
    throw new TypeError("comando de cleanup invalido");
  }
  if (typeof readStore !== "function" || typeof saveStore !== "function") {
    throw new TypeError("el ancla de cleanup requiere almacenamiento");
  }
  if (command.anchorDomain !== syntheticTenantDomain(command, command.anchorIndex)) {
    throw new TypeError("ancla de cleanup invalida");
  }
  const existing = await readStore(command.anchorDomain);
  if (existing) return { created: false, domain: command.anchorDomain };
  await saveStore(command.anchorDomain, {
    syntheticCapacityCleanup: true,
    cleanupRunId: command.runId
  });
  return { created: true, domain: command.anchorDomain };
}

function createCapacityCleanupHandler({ deleteJobs, deleteTenant, batchSize = 20 } = {}) {
  if (typeof deleteJobs !== "function") throw new TypeError("El handler requiere deleteJobs");
  if (typeof deleteTenant !== "function") throw new TypeError("El handler requiere deleteTenant");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new TypeError("batchSize invalido");
  }
  return Object.freeze({
    needsCompensation() {
      return false;
    },
    async run(job, { workerId, signal } = {}) {
      const command = parseCleanupCommand(job.payload);
      const jobsDeleted = await deleteJobs(command.prefix, workerId);
      if (!Number.isInteger(jobsDeleted) || jobsDeleted < 0) {
        const error = new Error("El cleanup devolvio un resultado invalido");
        error.nonRetryable = true;
        throw error;
      }

      // La limpieza larga se ejecuta en el worker, no durante el polling HTTP.
      // Cada borrado es idempotente, por lo que un reintento después de perder
      // un lease continúa de forma segura desde el mismo rango estricto.
      let tenantsProcessed = 0;
      let batches = 0;
      for (let start = command.anchorIndex + 1; start <= command.tenants; start += batchSize) {
        const end = Math.min(command.tenants, start + batchSize - 1);
        for (let index = start; index <= end; index += 1) {
          if (signal?.aborted) throw signal.reason || new Error("cleanup abortado");
          await deleteTenant(syntheticTenantDomain(command, index));
          tenantsProcessed += 1;
        }
        batches += 1;
      }

      return {
        mode: "cleanup",
        runId: command.runId,
        tenants: command.tenants,
        jobsDeleted,
        tenantCleanup: {
          batches,
          tenantsProcessed,
          anchorPending: 1
        }
      };
    }
  });
}

module.exports = {
  parseCleanupCommand,
  syntheticTenantDomain,
  ensureSyntheticCleanupAnchor,
  createCapacityCleanupHandler
};
