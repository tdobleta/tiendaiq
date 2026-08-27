"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createArtifact } = require("../scripts/sanitizar-evidencia-capacidad");

const RELEASE = "a".repeat(40);

test("la evidencia de capacidad conserva sólo métricas agregadas de la cola", () => {
  const artifact = createArtifact({
    release: RELEASE,
    mode: "run",
    exitCode: 0,
    log: [
      "texto crudo no permitido en el artefacto",
      JSON.stringify({ event: "queue_load_started", runId: "0123456789ab", tenants: 100, jobs: 100 }),
      JSON.stringify({
        passed: true,
        runId: "0123456789ab",
        tenants: 100,
        jobs: 100,
        workerLanes: 16,
        drainMs: 50,
        cleanup: { jobsDeleted: 100, storesDeleted: 100, tenantsDeleted: 100 },
        database_url: "database-uri-should-not-appear",
        error: "Bearer must-not-appear"
      })
    ].join("\n")
  });

  assert.deepEqual(artifact, {
    schema_version: 1,
    scope: "partner-staging-synthetic-queue",
    release_sha: RELEASE,
    mode: "run",
    completed: true,
    result_detected: true,
    result: {
      passed: true,
      runId: "0123456789ab",
      tenants: 100,
      jobs: 100,
      workerLanes: 16,
      drainMs: 50,
      cleanup: { jobsDeleted: 100, storesDeleted: 100, tenantsDeleted: 100 }
    }
  });
  assert.doesNotMatch(JSON.stringify(artifact), /postgres|Bearer|password/i);
});

test("una falla no copia la salida cruda al artefacto", () => {
  const artifact = createArtifact({
    release: RELEASE,
    mode: "cleanup",
    exitCode: 2,
    log: "Prueba de capacidad no ejecutada: detalle crudo no permitido"
  });

  assert.deepEqual(artifact, {
    schema_version: 1,
    scope: "partner-staging-synthetic-queue",
    release_sha: RELEASE,
    mode: "cleanup",
    completed: false,
    result_detected: false
  });
});
