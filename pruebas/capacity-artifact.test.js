"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createArtifact } = require("../scripts/sanitizar-evidencia-capacidad");
const { cleanupFailureClass, cleanupFailureOrigin, cleanupSyntheticRun, requiredInteger } = require("../scripts/probar-capacidad-cola");

const RELEASE = "a".repeat(40);

test("la clasificación de cleanup deriva categorías seguras desde SQLSTATE sin exponerlo", () => {
  assert.equal(cleanupFailureClass({ code: "42501", message: "no debe prevalecer" }), "authorization");
  assert.equal(cleanupFailureClass({ code: "23503" }), "referential_integrity");
  assert.equal(cleanupFailureClass({ code: "42P01" }), "schema");
  assert.equal(cleanupFailureClass({ code: "08006" }), "connection");
  assert.equal(cleanupFailureClass(new Error("outer", { cause: { code: "40P01" } })), "transaction");
  assert.equal(cleanupFailureClass(new AggregateError([{ code: "53300" }])), "resource");
  assert.equal(cleanupFailureClass({ code: "XX000" }), "unclassified");
});

test("el origen de cleanup discrimina Postgres de runtime sin exponer códigos", () => {
  assert.equal(cleanupFailureOrigin({ code: "42501" }), "postgres");
  assert.equal(cleanupFailureOrigin(Object.assign(new Error("socket"), { code: "ECONNRESET" })), "runtime");
  assert.equal(cleanupFailureOrigin({}), "unknown");
});

test("una falla al borrar jobs bloquea tenants sin intentar borrarlos", async () => {
  const workerPool = {
    async connect() {
      throw { code: "42501", message: "no debe quedar en evidencia" };
    }
  };
  const webPool = new Proxy({}, {
    get() {
      throw new Error("no debe tocarse el pool web cuando jobs falla");
    }
  });
  await assert.rejects(
    cleanupSyntheticRun({
      workerPool,
      webPool,
      tenants: [{ tenantId: "capacity-0123456789ab-1.myshopify.com" }],
      setupConcurrency: 1,
      prefix: "capacity-0123456789ab"
    }),
    (error) => {
      assert.deepEqual(error.cleanupEvidence, {
        jobsDeleted: 0,
        storesDeleted: 0,
        tenantsDeleted: 0,
        failedJobDeletion: true,
        failedTenantDeletions: 0,
        attemptedTenantDeletions: 0,
        tenantCleanupStatus: "blocked_by_job_cleanup",
        jobFailureClass: "authorization",
        jobFailureStage: "connect",
        jobFailureOrigin: "postgres"
      });
      return true;
    }
  );
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
          attemptedTenantDeletions: 100,
          tenantCleanupStatus: "completed_with_failures",
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
      tenantFailureClass: "referential_integrity",
      attemptedTenantDeletions: 100,
      tenantCleanupStatus: "completed_with_failures"
    },
    failure: { class: "database_authorization", phase: "tenant_setup" }
  });
  assert.doesNotMatch(JSON.stringify(artifact), /password|must-not-appear|permission denied/i);
});

test("la evidencia conserva el bloqueo causal de tenants sin campos libres", () => {
  const artifact = createArtifact({
    release: RELEASE,
    mode: "cleanup",
    exitCode: 2,
    log: [
      JSON.stringify({ event: "queue_load_phase", phase: "cleanup" }),
      JSON.stringify({
        event: "queue_load_cleanup_result",
        cleanup: {
          jobsDeleted: 0,
          storesDeleted: 0,
          tenantsDeleted: 0,
          failedJobDeletion: true,
          failedTenantDeletions: 0,
          attemptedTenantDeletions: 0,
          tenantCleanupStatus: "blocked_by_job_cleanup",
          jobFailureClass: "authorization",
          jobFailureStage: "delete_capacity_jobs",
          jobFailureOrigin: "postgres",
          sqlState: "42501",
          error: "must-not-appear"
        }
      })
    ].join("\n")
  });
  assert.deepEqual(artifact.cleanup, {
    jobsDeleted: 0,
    storesDeleted: 0,
    tenantsDeleted: 0,
    failedJobDeletion: true,
    failedTenantDeletions: 0,
    attemptedTenantDeletions: 0,
    tenantCleanupStatus: "blocked_by_job_cleanup",
    jobFailureClass: "authorization",
    jobFailureStage: "delete_capacity_jobs",
    jobFailureOrigin: "postgres"
  });
  assert.doesNotMatch(JSON.stringify(artifact), /42501|must-not-appear/i);
});

test("el artefacto de probe no expone conexión ni errores crudos", () => {
  const artifact = createArtifact({
    release: RELEASE,
    mode: "probe",
    exitCode: 1,
    log: JSON.stringify({
      event: "queue_load_connection_probe",
      passed: false,
      mode: "probe",
      probe: {
        web: { ok: true },
        worker: {
          ok: false,
          failureClass: "unclassified",
          failureOrigin: "runtime",
          failureStage: "connect",
          rawError: "password=must-not-appear"
        }
      }
    })
  });
  assert.deepEqual(artifact, {
    schema_version: 1,
    scope: "partner-staging-runtime-db-connectivity",
    release_sha: RELEASE,
    mode: "probe",
    completed: false,
    result_detected: true,
    result: {
      passed: false,
      probe: {
        web: { ok: true },
        worker: { ok: false, failureClass: "unclassified", failureOrigin: "runtime", failureStage: "connect" }
      }
    },
    failure: { class: "database_connection", phase: "unknown" }
  });
  assert.doesNotMatch(JSON.stringify(artifact), /password|must-not-appear/i);
});
