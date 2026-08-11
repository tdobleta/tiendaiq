"use strict";

function createJobRunner({
  repository,
  handlers,
  workerId,
  jobTypes = null,
  leaseSeconds = 300,
  pollMs = 1000,
  heartbeatMs = null,
  reportError = () => {},
  metrics = () => {}
}) {
  if (!repository?.claim || !repository?.succeed || !repository?.fail) {
    throw new TypeError("El runner requiere claim, succeed y fail");
  }
  if (!workerId) throw new TypeError("El runner requiere workerId");

  let stopped = false;
  let timer = null;
  let active = null;

  async function processOnce() {
    const job = await repository.claim(workerId, leaseSeconds, jobTypes);
    if (!job) return false;
    const startedAt = Date.now();
    const handler = handlers[job.type] || handlers["*"];
    let heartbeatTimer = null;
    let heartbeatChain = Promise.resolve();

    function startHeartbeat() {
      if (typeof repository.renew !== "function") return;
      const everyMs = heartbeatMs == null
        ? Math.max(1000, Math.floor(Number(leaseSeconds) * 1000 / 3))
        : Math.max(1, Number(heartbeatMs) || 1);
      heartbeatTimer = setInterval(() => {
        heartbeatChain = heartbeatChain
          .then(async () => {
            const renewed = await repository.renew(job.tenant, job);
            if (!renewed) {
              reportError(new Error("El worker perdió el lease durante la ejecución"), {
                tipo: "job-lease-lost", jobId: job.id, jobType: job.type, tenant: job.tenantId
              });
            } else {
              job.lockedAt = renewed.lockedAt;
            }
          })
          .catch((error) => reportError(error, {
            tipo: "job-heartbeat", jobId: job.id, jobType: job.type, tenant: job.tenantId
          }));
      }, everyMs);
      heartbeatTimer.unref?.();
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
        result = await handler.run(job);
      } finally {
        await stopHeartbeat();
      }
      const completed = await repository.succeed(job.tenant, job, result || {});
      if (!completed) {
        reportError(new Error("El worker perdió el lease antes de completar"), {
          tipo: "job-lease-lost", jobId: job.id, jobType: job.type, tenant: job.tenantId
        });
      }
      metrics("job_completado", {
        job_type: job.type,
        worker_id: workerId,
        segundos: (Date.now() - startedAt) / 1000
      });
    } catch (error) {
      if (error.nonRetryable) job.attempts = job.maxAttempts;
      const delay = Math.min(300, 2 ** Math.max(0, Number(job.attempts) - 1) * 5);
      const terminal = Number(job.attempts) >= Number(job.maxAttempts);
      if (terminal && handler?.compensateBeforeTerminal && handler?.onTerminalFailure) {
        await handler.onTerminalFailure(job, error);
      }
      const updated = await repository.fail(job.tenant, job, error, delay);
      reportError(error, { tipo: "job", jobId: job.id, jobType: job.type, tenant: job.tenantId, terminal: updated?.status === "failed" });
      if (updated?.status === "failed" && !handler?.compensateBeforeTerminal && handler?.onTerminalFailure) {
        await handler.onTerminalFailure(job, error);
      }
      metrics("job_fallido", {
        job_type: job.type,
        worker_id: workerId,
        terminal: updated?.status === "failed",
        segundos: (Date.now() - startedAt) / 1000
      });
    }
    return true;
  }

  async function tick() {
    if (stopped) return;
    timer = null;
    try {
      active = processOnce();
      const processed = await active;
      active = null;
      if (!stopped) timer = setTimeout(tick, processed ? 0 : pollMs);
    } catch (error) {
      active = null;
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
      if (active) await active.catch(() => {});
    }
  });
}

module.exports = { createJobRunner };
