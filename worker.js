"use strict";

const os = require("os");
const { randomUUID } = require("crypto");
const { createRuntime } = require("./src/jobs/runtime");
const { reportarError } = require("./monitoreo");
const {
  verificarWorkerDB,
  registrarHeartbeatWorkerDB,
  cerrarAlmacenamientoDB
} = require("./db");

const PREFLIGHT_TIMEOUT_MS = Math.max(1000, Number(process.env.WORKER_PREFLIGHT_TIMEOUT_MS) || 15000);
const HEARTBEAT_MS = Math.max(5000, Number(process.env.WORKER_HEARTBEAT_MS) || 15000);
const SHUTDOWN_TIMEOUT_MS = Math.max(1000, Number(process.env.WORKER_SHUTDOWN_TIMEOUT_MS) || 10000);
const HEARTBEAT_FAILURE_LIMIT = 3;
let runtime = null;

function enteroAcotado(value, fallback, min = 1, max = 32) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function identidadWorker(runtimeEnv = process.env) {
  const releaseSha = String(runtimeEnv.RENDER_GIT_COMMIT || runtimeEnv.GIT_COMMIT || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) {
    throw new Error("El worker requiere RENDER_GIT_COMMIT con el SHA completo del release");
  }
  const runtimeRole = String(runtimeEnv.PG_RUNTIME_ROLE || "");
  if (runtimeRole !== "tiendaiq_worker_runtime") {
    throw new Error("El worker requiere PG_RUNTIME_ROLE=tiendaiq_worker_runtime");
  }
  return {
    workerId: `${os.hostname()}:${process.pid}:${randomUUID()}`,
    releaseSha,
    runtimeRole,
    capacity: {
      generations: enteroAcotado(runtimeEnv.JOB_GENERATION_CONCURRENCY, 2),
      publications: enteroAcotado(runtimeEnv.JOB_PUBLICATION_CONCURRENCY, 2),
      webhooks: enteroAcotado(runtimeEnv.WEBHOOK_CONCURRENCY, 1)
    }
  };
}

async function esperarConPlazo(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), Math.max(1, timeoutMs));
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function apagarWorker({
  activeRuntime = runtime,
  cerrarAlmacenamiento = cerrarAlmacenamientoDB,
  timeoutMs = SHUTDOWN_TIMEOUT_MS,
  reportar = reportarError
} = {}) {
  const totalMs = Math.max(2, Number(timeoutMs) || SHUTDOWN_TIMEOUT_MS);
  const closeBudgetMs = Math.max(1, Math.floor(totalMs / 4));
  const stopBudgetMs = Math.max(1, totalMs - closeBudgetMs);
  let failure = null;

  if (activeRuntime?.stop) {
    try {
      await esperarConPlazo(
        activeRuntime.stop(),
        stopBudgetMs,
        `worker runtime no se detuvo en ${stopBudgetMs} ms`
      );
    } catch (error) {
      failure = error;
      reportar(error, { tipo: "worker-shutdown-runtime" });
    }
  }

  try {
    await esperarConPlazo(
      cerrarAlmacenamiento(),
      closeBudgetMs,
      `el almacenamiento no cerro en ${closeBudgetMs} ms`
    );
  } catch (error) {
    failure ||= error;
    reportar(error, { tipo: "worker-shutdown-storage" });
  }

  if (failure) throw failure;
}

async function iniciarWorker({
  verificar = verificarWorkerDB,
  registrarHeartbeat = registrarHeartbeatWorkerDB,
  crearRuntime = createRuntime,
  runtimeEnv = process.env,
  timeoutMs = PREFLIGHT_TIMEOUT_MS,
  heartbeatMs = HEARTBEAT_MS,
  setIntervalFn = setInterval,
  cerrarAlmacenamiento = cerrarAlmacenamientoDB,
  shutdownTimeoutMs = SHUTDOWN_TIMEOUT_MS,
  terminate = (code) => process.exit(code),
  reportar = reportarError
} = {}) {
  let timeout;
  let preflight;
  try {
    preflight = await Promise.race([
      verificar(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`preflight excedio ${timeoutMs} ms`)), timeoutMs);
        timeout.unref?.();
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }

  const identity = identidadWorker(runtimeEnv);
  const heartbeat = {
    ...identity,
    isolationOk: preflight?.tipo === "postgres" &&
      preflight?.aislamiento?.forced === true &&
      preflight?.aislamiento?.workerCapability === true
  };
  if (!heartbeat.isolationOk) {
    throw new Error("El worker no puede iniciar sin aislamiento RLS forzado y capacidad worker");
  }
  const activeRuntime = crearRuntime({
    workerId: identity.workerId,
    generationConcurrency: identity.capacity.generations,
    publicationConcurrency: identity.capacity.publications,
    webhookConcurrency: identity.capacity.webhooks
  });
  try {
    activeRuntime.start();
    await registrarHeartbeat(heartbeat);
  } catch (error) {
    await activeRuntime.stop().catch(() => {});
    throw error;
  }
  let heartbeatFailures = 0;
  let heartbeatInFlight = false;
  let heartbeatTimer = setIntervalFn(async () => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    try {
      await registrarHeartbeat(heartbeat);
      heartbeatFailures = 0;
    } catch (error) {
      heartbeatFailures += 1;
      reportar(error, { tipo: "worker-heartbeat", intentos: heartbeatFailures });
      if (heartbeatFailures < HEARTBEAT_FAILURE_LIMIT) return;
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      try {
        await apagarWorker({
          activeRuntime,
          cerrarAlmacenamiento,
          timeoutMs: shutdownTimeoutMs,
          reportar
        });
      } catch (shutdownError) {
        reportar(shutdownError, { tipo: "worker-heartbeat-shutdown" });
      } finally {
        terminate(1);
      }
    } finally {
      heartbeatInFlight = false;
    }
  }, heartbeatMs);
  heartbeatTimer.unref?.();
  return Object.freeze({
    ...activeRuntime,
    async stop() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      await activeRuntime.stop();
    }
  });
}

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    await apagarWorker();
    process.exitCode = 0;
  } catch (error) {
    console.error("No se pudo cerrar el worker limpiamente:", error.message);
    process.exitCode = 1;
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, shutdown);
}

if (require.main === module) {
  iniciarWorker()
    .then((activeRuntime) => {
      runtime = activeRuntime;
      console.log("  worker TiendaIQ iniciado despues del preflight");
    })
    .catch(async (error) => {
      console.error("Worker detenido por preflight fallido:", error.message);
      try {
        await cerrarAlmacenamientoDB();
      } catch (closeError) {
        console.error("No se pudo cerrar Postgres tras el preflight:", closeError.message);
      }
      process.exitCode = 1;
    });
}

module.exports = {
  HEARTBEAT_FAILURE_LIMIT,
  SHUTDOWN_TIMEOUT_MS,
  apagarWorker,
  identidadWorker,
  iniciarWorker
};
