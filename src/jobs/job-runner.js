"use strict";

class LeaseLostError extends Error {
  constructor(message = "El worker perdio el lease durante la ejecucion", options = {}) {
    super(message, options);
    this.name = "LeaseLostError";
    this.code = "JOB_LEASE_LOST";
  }
}

function withDeadline(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new LeaseLostError(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isNonRetryable(error) {
  if (error?.nonRetryable) return true;
  return [400, 401, 402, 403, 404, 405, 406, 410, 411, 413, 414, 415, 422]
    .includes(Number(error?.status));
}

function retryDelaySeconds(error, attempts) {
  const requested = Number(error?.retryAfter);
  if (Number.isFinite(requested) && requested >= 0) return Math.min(900, Math.ceil(requested));
  return Math.min(300, 2 ** Math.max(0, Number(attempts) - 1) * 5);
}

function createJobRunner({
  repository,
  handlers,
  workerId,
  releaseSha = null,
  jobTypes = null,
  leaseSeconds = 300,
  pollMs = 1000,
  heartbeatMs = null,
  shutdownTimeoutMs = 5000,
  reportError = () => {},
  metrics = () => {}
}) {
  if (!repository?.claim || !repository?.succeed || !repository?.fail) {
    throw new TypeError("El runner requiere claim, succeed y fail");
  }
  if (!workerId) throw new TypeError("El runner requiere workerId");
  if (!/^[a-f0-9]{40}$/.test(String(releaseSha || ""))) {
    throw new TypeError("El runner requiere releaseSha completo");
  }

  let stopped = false;
  let timer = null;
  let active = null;
  let activeLoseLease = null;

  async function executeOnce() {
    const job = await repository.claim(workerId, releaseSha, leaseSeconds, jobTypes);
    if (!job) return false;
    const startedAt = Date.now();
    const handler = handlers[job.type] || handlers["*"];
    let heartbeatTimer = null;
    let heartbeatChain = Promise.resolve();
    let leaseError = null;
    const abortController = new AbortController();

    function loseLease(error) {
      if (leaseError) return leaseError;
      leaseError = error instanceof LeaseLostError
        ? error
        : new LeaseLostError("No se pudo confirmar la propiedad del lease", { cause: error });
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      abortController.abort(leaseError);
      reportError(leaseError, {
        tipo: "job-lease-lost", jobId: job.id, jobType: job.type, tenant: job.tenantId
      });
      return leaseError;
    }
    activeLoseLease = loseLease;
    if (stopped) loseLease(new LeaseLostError("El worker se apago despues de reclamar el lease"));

    function startHeartbeat() {
      if (typeof repository.renew !== "function") return;
      const everyMs = heartbeatMs == null
        ? Math.max(1000, Math.floor(Number(leaseSeconds) * 1000 / 3))
        : Math.max(1, Number(heartbeatMs) || 1);
      const renewalDeadlineMs = Math.max(1, Math.min(
        everyMs,
        5000,
        Math.floor(Number(leaseSeconds) * 1000 / 4)
      ));
      heartbeatTimer = setInterval(() => {
        heartbeatChain = heartbeatChain
          .then(async () => {
            const renewed = await withDeadline(
              repository.renew(job.tenant, job, leaseSeconds),
              renewalDeadlineMs,
              "La renovacion del lease excedio su plazo seguro"
            );
            if (!renewed) {
              loseLease(new LeaseLostError());
            } else {
              job.lockedAt = renewed.lockedAt;
              job.leaseExpiresAt = renewed.leaseExpiresAt;
            }
          })
          .catch((error) => loseLease(error));
      }, everyMs);
    }

    async function stopHeartbeat() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      await heartbeatChain;
    }

    try {
      if (!handler?.run) {
        const error = new Error(`No existe handler para ${job.type}`);
        error.nonRetryable = true;
        throw error;
      }
      startHeartbeat();
      let result;
      try {
        result = await handler.run(job, { signal: abortController.signal, workerId, releaseSha });
      } finally {
        await stopHeartbeat();
      }
      if (leaseError) throw leaseError;
      const persistedResult = releaseSha
        ? { ...(result || {}), _execution: { releaseSha } }
        : (result || {});
      const completed = await repository.succeed(job.tenant, job, persistedResult);
      if (!completed) {
        throw loseLease(new LeaseLostError("El worker perdio el lease antes de completar"));
      }
      metrics("job_completado", {
        job_type: job.type,
        worker_id: workerId,
        segundos: (Date.now() - startedAt) / 1000
      });
    } catch (error) {
      if (error?.code === "JOB_LEASE_LOST" || leaseError) {
        metrics("job_lease_perdido", {
          job_type: job.type,
          worker_id: workerId,
          segundos: (Date.now() - startedAt) / 1000
        });
        return true;
      }
      if (isNonRetryable(error)) job.attempts = job.maxAttempts;
      const delay = retryDelaySeconds(error, job.attempts);
      const hasCompensation = typeof handler?.onTerminalFailure === "function"
        && (typeof handler?.needsCompensation !== "function" || handler.needsCompensation(job, error));
      const updated = await repository.fail(job.tenant, job, error, delay, hasCompensation);
      if (!updated) {
        loseLease(new LeaseLostError("El worker perdio el lease antes de registrar el fallo"));
        metrics("job_lease_perdido", {
          job_type: job.type,
          worker_id: workerId,
          segundos: (Date.now() - startedAt) / 1000
        });
        return true;
      }
      reportError(error, { tipo: "job", jobId: job.id, jobType: job.type, tenant: job.tenantId, terminal: updated?.status === "failed" });
      // Durable repositories expose the pending marker returned by the same
      // transaction that made the failure terminal. Test doubles without that
      // contract retain the synchronous fallback.
      if (updated?.status === "failed" && hasCompensation && updated.compensationStatus !== "pending") {
        await handler.onTerminalFailure(job, error);
      }
      metrics("job_fallido", {
        job_type: job.type,
        worker_id: workerId,
        terminal: updated?.status === "failed",
        segundos: (Date.now() - startedAt) / 1000
      });
    } finally {
      if (activeLoseLease === loseLease) activeLoseLease = null;
    }
    return true;
  }

  function processOnce() {
    if (active) return active;
    const execution = executeOnce();
    active = execution;
    execution.finally(() => {
      if (active === execution) active = null;
    }).catch(() => {});
    return execution;
  }

  async function tick() {
    if (stopped) return;
    timer = null;
    try {
      const processed = await processOnce();
      if (!stopped) timer = setTimeout(tick, processed ? 0 : pollMs);
    } catch (error) {
      reportError(error, { tipo: "worker-loop", workerId });
      if (!stopped) timer = setTimeout(tick, pollMs);
    }
  }

  return Object.freeze({
    processOnce,
    start() {
      if (!stopped && !timer) timer = setTimeout(tick, 0);
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (!active) return;

      activeLoseLease?.(new LeaseLostError("El worker se esta apagando; el lease queda recuperable"));
      try {
        await withDeadline(
          active.catch(() => {}),
          Math.max(1, Number(shutdownTimeoutMs) || 5000),
          "El apagado del job runner excedio su plazo"
        );
      } catch (error) {
        reportError(error, { tipo: "worker-stop-timeout", workerId });
      }
    }
  });
}

module.exports = {
  LeaseLostError,
  createJobRunner,
  isNonRetryable,
  retryDelaySeconds,
  withDeadline
};
