"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createArtifact } = require("../scripts/sanitizar-evidencia-capacidad");
const { cleanupFailureClass, requiredInteger } = require("../scripts/probar-capacidad-cola");

const RELEASE = "a".repeat(40);

test("la clasificación de cleanup deriva categorías seguras desde SQLSTATE sin exponerlo", () => {
  assert.equal(cleanupFailureClass({ code: "42501", message: "no debe prevalecer" }), "authorization");
  assert.equal(cleanupFailureClass({ code: "23503" }), "referential_integrity");
  assert.equal(cleanupFailureClass({ code: "42P01" }), "schema");
  assert.equal(cleanupFailureClass({ code: "08006" }), "connection");
  assert.equal(cleanupFailureClass({ code: "XX000" }), "unclassified");
});

test("cleanup exige un conteo explícito y acotado de tenants", () => {
  assert.equal(requiredInteger("100", 1, 2000, "LOAD_TENANTS"), 100);
  assert.throws(() => requiredInteger("", 1, 2000, "LOAD_TENANTS"), /obligatorio/);
  assert.throws(() => requiredInteger("2001", 1, 2000, "LOAD_TENANTS"), /entre 1 y 2000/);
});

test("la evidencia de capacidad conserva sólo métricas agregadas de la cola", () => {
  const artifact = createArtifact({
    release: RELEASE,
    mode: "run",
    exitCode: 0,
    log: [
      "texto crudo no permitido en el artefacto",
      JSON.stringify({ event: "queue_load_started", runId: "0123456789ab", tenants: 100, jobs: 100 }),
      JSON.stringify({ event: "queue_load_phase", phase: "tenant_setup" }),
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
    log: [
      JSON.stringify({ event: "queue_load_started", runId: "0123456789ab", tenants: 100, jobs: 100 }),
      JSON.stringify({ event: "queue_load_phase", phase: "tenant_setup" }),
      JSON.stringify({
        event: "queue_load_cleanup_result",
        cleanup: {
          jobsDeleted: 100,
          storesDeleted: 98,
          tenantsDeleted: 98,
          failedJobDeletion: false,
          failedTenantDeletions: 2,
          tenantFailureClass: "referential_integrity",
          rawError: "password=must-not-appear"
        }
      }),
      "Prueba de capacidad no ejecutada: permission denied for table control_plane.tenants; password=must-not-appear"
    ].join("\n")
  });

  assert.deepEqual(artifact, {
    schema_version: 1,
    scope: "partner-staging-synthetic-queue",
    release_sha: RELEASE,
    mode: "cleanup",
    completed: false,
    result_detected: true,
    result: { runId: "0123456789ab", tenants: 100, jobs: 100 },
    cleanup: {
      jobsDeleted: 100,
      storesDeleted: 98,
      tenantsDeleted: 98,
      failedJobDeletion: false,
      failedTenantDeletions: 2,
      tenantFailureClass: "referential_integrity"
    },
    failure: { class: "database_authorization", phase: "tenant_setup" }
  });
  assert.doesNotMatch(JSON.stringify(artifact), /password|must-not-appear|permission denied/i);
});
