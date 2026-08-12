"use strict";

const { createRuntime } = require("./src/jobs/runtime");
const { verificarWorkerDB, cerrarAlmacenamientoDB } = require("./db");

const PREFLIGHT_TIMEOUT_MS = Math.max(1000, Number(process.env.WORKER_PREFLIGHT_TIMEOUT_MS) || 15000);
let runtime = null;

async function iniciarWorker({
  verificar = verificarWorkerDB,
  crearRuntime = createRuntime,
  timeoutMs = PREFLIGHT_TIMEOUT_MS
} = {}) {
  let timeout;
  try {
    await Promise.race([
      verificar(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`preflight excedio ${timeoutMs} ms`)), timeoutMs);
        timeout.unref?.();
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }

  const activeRuntime = crearRuntime();
  activeRuntime.start();
  return activeRuntime;
}

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    if (runtime) await runtime.stop();
    await cerrarAlmacenamientoDB();
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

module.exports = { iniciarWorker };
