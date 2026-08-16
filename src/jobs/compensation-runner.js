"use strict";

const { LeaseLostError, withDeadline } = require("./job-runner");

function createCompensationRunner({
  repository,
  handlers,
  workerId,
  jobTypes = null,
  leaseSeconds = 300,
  pollMs = 1000,
  heartbeatMs = null,
  shutdownTimeoutMs = 5000,
  maxAttempts = 8,
  reportError = () => {},
  metrics = () => {}
}) {
  if (!repository?.claimCompensation || !repository?.renewCompensation ||
      !repository?.completeCompensation || !repository?.failCompensation) {
    throw new TypeError("El runner de compensacion requiere un repositorio durable");
  }
  if (!workerId) throw new TypeError("El runner de compensacion requiere workerId");

  let stopped = false;
  let timer = null;
  let active = null;
  let activeLoseLease = null;

  async function executeOnce() {
    const job = await repository.claimCompensation(workerId, leaseSeconds, jobTypes);
    if (!job) return false;
    const handler = handlers[job.type] || handlers["*"];
    const startedAt = Date.now();
    const abortController = new AbortController();
    let heartbeatTimer = null;
    let heartbeatChain = Promise.resolve();
    let leaseError = null;

    function loseLease(error) {
      if (leaseError) return leaseError;
      leaseError = error instanceof LeaseLostError
        ? error
        : new LeaseLostError("No se pudo confirmar el lease de compensacion", { cause: error });
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      abortController.abort(leaseError);
      reportError(leaseError, {
        tipo: "job-compensation-lease-lost", jobId: job.id, jobType: job.type, tenant: job.tenantId
      });
      return leaseError;
    }
    activeLoseLease = loseLease;
    if (stopped) loseLease(new LeaseLostError("El worker se apago despues de reclamar la compensacion"));

    function startHeartbeat() {
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
              repository.renewCompensation(job.tenant, job, leaseSeconds),
              renewalDeadlineMs,
              "La renovacion de la compensacion excedio su plazo seguro"
            );
            if (!renewed) loseLease(new LeaseLostError("Se perdio el lease de compensacion"));
            else {
              job.compensationLockedAt = renewed.compensationLockedAt;
              job.compensationLeaseExpiresAt = renewed.compensationLeaseExpiresAt;
            }
          })
          .catch(loseLease);
      }, everyMs);
    }

    async function stopHeartbeat() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      await heartbeatChain;
    }

    try {
      if (typeof handler?.onTerminalFailure !== "function") {
        throw new Error(`No existe compensacion para ${job.type}`);
      }
      const terminalError = new Error(job.lastError || "Fallo terminal recuperado");
      startHeartbeat();
      try {
        await handler.onTerminalFailure(job, terminalError, {
          signal: abortController.signal,
          workerId
        });
      } finally {
        await stopHeartbeat();
      }
      if (leaseError) throw leaseError;
      const completed = await repository.completeCompensation(job.tenant, job);
      if (!completed) throw loseLease(new LeaseLostError("Se perdio el lease antes de confirmar la compensacion"));
      metrics("job_compensado", {
        job_type: job.type,
        worker_id: workerId,
        intentos: job.compensationAttempts,
        segundos: (Date.now() - startedAt) / 1000
      });
    } catch (error) {
      if (error?.code === "JOB_LEASE_LOST" || leaseError) {
        metrics("job_compensacion_lease_perdido", {
          job_type: job.type,
          worker_id: workerId,
          segundos: (Date.now() - startedAt) / 1000
        });
        return true;
      }
      const delay = Math.min(300, 2 ** Math.max(0, Number(job.compensationAttempts) - 1) * 5);
      const terminal = error?.nonRetryable === true ||
        Number(job.compensationAttempts) >= Math.max(1, Number(maxAttempts) || 8);
      const rescheduled = await repository.failCompensation(job.tenant, job, error, delay, terminal);
      if (!rescheduled) {
        loseLease(new LeaseLostError("Se perdio el lease antes de registrar el fallo de compensacion"));
        return true;
      }
      reportError(error, {
        tipo: "job-compensation",
        jobId: job.id,
        jobType: job.type,
        tenant: job.tenantId,
        rescheduled: rescheduled.compensationStatus === "pending",
        deadLetter: rescheduled.compensationStatus === "dead_letter"
      });
      metrics("job_compensacion_fallida", {
        job_type: job.type,
        worker_id: workerId,
        reprogramada: rescheduled.compensationStatus === "pending",
        cuarentena: rescheduled.compensationStatus === "dead_letter",
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
      reportError(error, { tipo: "compensation-loop", workerId });
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

      activeLoseLease?.(new LeaseLostError("El worker se esta apagando; la compensacion queda recuperable"));
      try {
        await withDeadline(
          active.catch(() => {}),
          Math.max(1, Number(shutdownTimeoutMs) || 5000),
          "El apagado del compensation runner excedio su plazo"
        );
      } catch (error) {
        reportError(error, { tipo: "compensation-stop-timeout", workerId });
      }
    }
  });
}

module.exports = { createCompensationRunner };
