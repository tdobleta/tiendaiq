"use strict";

const { createRuntime } = require("./src/jobs/runtime");
const { cerrarAlmacenamientoDB } = require("./db");

const runtime = createRuntime();
runtime.start();
console.log("  worker TiendaIQ iniciado");

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    await runtime.stop();
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
