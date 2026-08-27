"use strict";

const crypto = require("crypto");
const { performance } = require("perf_hooks");
const { Pool } = require("pg");
const { TenantContext } = require("../src/tenancy/tenant-context");
const { createPostgresPool } = require("../src/platform/postgres/create-pool");
const { createJobRepository } = require("../src/platform/postgres/job-repository");
const { withTenantTransaction } = require("../src/platform/postgres/with-tenant-transaction");

const REMOTE_AUTHORIZATION = "I_UNDERSTAND_THIS_WRITES_SYNTHETIC_STAGING_DATA";
const WEB_RUNTIME_ROLE = "tiendaiq_web_runtime";
const WORKER_RUNTIME_ROLE = "tiendaiq_worker_runtime";

function integer(value, fallback, min, max, name) {
  const parsed = value == null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} debe ser un entero entre ${min} y ${max}`);
  }
  return parsed;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function normalizeRunId(value) {
  const runId = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{12}$/.test(runId)) {
    throw new Error("LOAD_CLEANUP_RUN_ID debe ser el runId hexadecimal de 12 caracteres registrado por la prueba");
  }
  return runId;
}

function normalizeReleaseSha(value) {
  const releaseSha = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) {
    throw new Error("EXPECTED_RELEASE_SHA debe ser el SHA completo revisado de 40 caracteres");
  }
  return releaseSha;
}

function errorSummary(error) {
  if (error instanceof AggregateError) {
    return error.errors.map(errorSummary).join(" | ");
  }
  return String(error?.message || error);
}

function assertAuthorized(urlValue, name) {
  if (!urlValue) throw new Error(`Falta ${name}`);
  const url = new URL(urlValue);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (!local && process.env.ALLOW_REMOTE_QUEUE_LOAD_TEST !== REMOTE_AUTHORIZATION) {
    throw new Error(`Destino remoto bloqueado; defina ALLOW_REMOTE_QUEUE_LOAD_TEST=${REMOTE_AUTHORIZATION}`);
  }
}

async function parallelMap(items, concurrency, work) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await work(items[index], index);
    }
  });
  await Promise.all(workers);
}

function observePoolPeak(pool) {
  let peak = pool.totalCount;
  pool.on("connect", () => { peak = Math.max(peak, pool.totalCount); });
  return () => Math.max(peak, pool.totalCount);
}

async function inspectRunJobs(pool, workerId, prefix) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.worker_id', $1, true)", [workerId]);
    const result = await client.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'queued')::int AS queued,
              count(*) FILTER (WHERE status = 'running')::int AS running,
              count(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
              count(*) FILTER (WHERE status = 'failed')::int AS failed,
              coalesce(extract(epoch FROM (now() - min(created_at) FILTER (WHERE status = 'queued'))), 0)::float8
                AS oldest_queued_seconds
       FROM control_plane.jobs
       WHERE type = 'capacity-probe' AND idempotency_key LIKE $1`,
      [`${prefix}:%`]
    );
    await client.query("COMMIT");
    const row = result.rows[0] || {};
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value || 0)]));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupSyntheticRun({ workerPool, webPool, tenants, setupConcurrency, prefix }) {
  const errors = [];
  let jobsDeleted = 0;
  let storesDeleted = 0;
  let tenantsDeleted = 0;

  function evidence() {
    return {
      jobsDeleted,
      storesDeleted,
      tenantsDeleted,
      failedJobDeletion: errors.some((entry) => entry.scope === "jobs"),
      failedTenantDeletions: errors.filter((entry) => entry.scope === "tenant").length
    };
  }

  try {
    const client = await workerPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.worker_id', $1, true)", [`${prefix}:cleanup`]);
      const deleted = await client.query(
        "DELETE FROM control_plane.jobs WHERE type = 'capacity-probe' AND idempotency_key LIKE $1",
        [`${prefix}:%`]
      );
      jobsDeleted = deleted.rowCount;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    errors.push({ scope: "jobs" });
  }

  await parallelMap(tenants, setupConcurrency, async (tenant) => {
    try {
      await withTenantTransaction(webPool, tenant, async (client) => {
        const store = await client.query("DELETE FROM public.tiendas WHERE dominio = $1", [tenant.tenantId]);
        const registry = await client.query("DELETE FROM control_plane.tenants WHERE id = $1", [tenant.tenantId]);
        storesDeleted += store.rowCount;
        tenantsDeleted += registry.rowCount;
      });
    } catch (error) {
      errors.push({ scope: "tenant" });
    }
  });

  const result = evidence();
  if (errors.length) {
    const failure = new Error(`Limpieza incompleta para ${prefix}`);
    failure.cleanupEvidence = result;
    throw failure;
  }
  return result;
}

async function main() {
  if (process.env.ALLOW_QUEUE_LOAD_TEST !== "1") {
    throw new Error("Defina ALLOW_QUEUE_LOAD_TEST=1 para autorizar datos sinteticos desechables");
  }

  const webUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  const workerUrl = process.env.TEST_WORKER_DATABASE_URL;
  assertAuthorized(webUrl, "TEST_DATABASE_URL");
  assertAuthorized(workerUrl, "TEST_WORKER_DATABASE_URL");

  const cleanupOnly = Boolean(process.env.LOAD_CLEANUP_RUN_ID);
  const releaseSha = cleanupOnly ? null : normalizeReleaseSha(process.env.EXPECTED_RELEASE_SHA);
  const tenantsCount = integer(process.env.LOAD_TENANTS, cleanupOnly ? 2000 : 1000, 1, 2000, "LOAD_TENANTS");
  const jobsCount = integer(process.env.LOAD_JOBS, 1000, 1, 2000, "LOAD_JOBS");
  const setupConcurrency = integer(process.env.LOAD_SETUP_CONCURRENCY, 40, 1, 100, "LOAD_SETUP_CONCURRENCY");
  const workerLanes = integer(process.env.LOAD_WORKER_LANES, 16, 1, 32, "LOAD_WORKER_LANES");
  const fakeWorkMs = integer(process.env.LOAD_FAKE_WORK_MS, 5, 0, 5000, "LOAD_FAKE_WORK_MS");
  const maxDrainSeconds = integer(process.env.LOAD_MAX_DRAIN_SECONDS, 900, 1, 3600, "LOAD_MAX_DRAIN_SECONDS");
  const runId = cleanupOnly
    ? normalizeRunId(process.env.LOAD_CLEANUP_RUN_ID)
    : crypto.randomBytes(6).toString("hex");
  const prefix = `capacity-${runId}`;
  const tenants = Array.from({ length: tenantsCount }, (_, index) =>
    TenantContext.fromShopDomain(`${prefix}-${index + 1}.myshopify.com`, { source: "development" })
  );

  const webPool = createPostgresPool({
    databaseUrl: webUrl,
    caCertificate: process.env.PG_CA_CERT,
    runtimeRole: WEB_RUNTIME_ROLE,
    Pool
  });
  const workerPool = createPostgresPool({
    databaseUrl: workerUrl,
    caCertificate: process.env.PG_CA_CERT,
    runtimeRole: WORKER_RUNTIME_ROLE,
    Pool
  });
  const webPoolPeak = observePoolPeak(webPool);
  const workerPoolPeak = observePoolPeak(workerPool);
  const webJobs = createJobRepository(webPool);
  const workerJobs = createJobRepository(workerPool);
  const enqueueLatencies = [];
  let processed = 0;
  let processError = null;
  let result = null;
  let primaryError = null;
  let cleanup = null;
  let phase = "authorization";

  function recordPhase(nextPhase) {
    phase = nextPhase;
    console.log(JSON.stringify({ event: "queue_load_phase", phase }));
  }

  console.log(JSON.stringify({
    event: cleanupOnly ? "queue_load_cleanup_started" : "queue_load_started",
    runId,
    tenants: tenantsCount,
    jobs: cleanupOnly ? 0 : jobsCount
  }));

  try {
    if (!cleanupOnly) {
      recordPhase("tenant_setup");
      const setupStarted = performance.now();
      await parallelMap(tenants, setupConcurrency, (tenant) =>
        withTenantTransaction(webPool, tenant, async (client) => {
          await client.query(
            `INSERT INTO control_plane.tenants (id, shop_domain) VALUES ($1, $1)
             ON CONFLICT (id) DO NOTHING`,
            [tenant.tenantId]
          );
          await client.query(
            `INSERT INTO public.tiendas (dominio, datos) VALUES ($1, $2)
             ON CONFLICT (dominio) DO UPDATE SET datos = EXCLUDED.datos`,
            [tenant.tenantId, { dominio: tenant.tenantId, synthetic: true, run_id: runId }]
          );
        })
      );
      const setupMs = performance.now() - setupStarted;

      recordPhase("enqueue");
      const enqueueStarted = performance.now();
      const jobs = Array.from({ length: jobsCount }, (_, index) => index);
      await parallelMap(jobs, setupConcurrency, async (index) => {
        const tenant = tenants[index % tenants.length];
        const started = performance.now();
        await webJobs.enqueue(tenant, {
          type: "capacity-probe",
          payload: { synthetic: true, runId, sequence: index + 1 },
          idempotencyKey: `${prefix}:${index + 1}`,
          maxAttempts: 2
        });
        enqueueLatencies.push(performance.now() - started);
      });
      const enqueueMs = performance.now() - enqueueStarted;
      const queued = await inspectRunJobs(workerPool, `${prefix}:metrics:queued`, prefix);
      if (queued.total !== jobsCount || queued.queued !== jobsCount) {
        throw new Error(`La cola persistio ${queued.queued}/${jobsCount} jobs sinteticos`);
      }

      recordPhase("drain");
      const drainStarted = performance.now();
      async function lane(index) {
        while (!processError) {
          const current = await workerJobs.claim(
            `${prefix}:worker:${index}`,
            releaseSha,
            120,
            ["capacity-probe"]
          );
          if (!current) return;
          try {
            if (fakeWorkMs) await new Promise((resolve) => setTimeout(resolve, fakeWorkMs));
            const completed = await workerJobs.succeed(current.tenant, current, { synthetic: true });
            if (!completed) throw new Error(`Lease perdido para ${current.id}`);
            processed += 1;
          } catch (error) {
            processError = error;
            return;
          }
        }
      }
      await Promise.all(Array.from({ length: workerLanes }, (_, index) => lane(index + 1)));
      const drainMs = performance.now() - drainStarted;
      if (processError) throw processError;
      if (processed !== jobsCount) throw new Error(`Se procesaron ${processed}/${jobsCount} jobs`);
      recordPhase("verification");
      const drained = await inspectRunJobs(workerPool, `${prefix}:metrics:drained`, prefix);
      if (drained.succeeded !== jobsCount || drained.queued || drained.running || drained.failed) {
        throw new Error(`Estado final invalido: ${JSON.stringify(drained)}`);
      }

      result = {
        passed: drainMs / 1000 <= maxDrainSeconds,
        runId,
        tenants: tenantsCount,
        jobs: jobsCount,
        workerLanes,
        fakeWorkMs,
        setupMs,
        enqueueMs,
        enqueueP95Ms: percentile(enqueueLatencies, 0.95),
        oldestQueuedSeconds: queued.oldest_queued_seconds,
        drainMs,
        jobsPerSecond: jobsCount / Math.max(0.001, drainMs / 1000),
        maxDrainSeconds,
        webPoolPeak: webPoolPeak(),
        workerPoolPeak: workerPoolPeak()
      };
    }
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      recordPhase("cleanup");
      cleanup = await cleanupSyntheticRun({ workerPool, webPool, tenants, setupConcurrency, prefix });
      const remaining = await inspectRunJobs(workerPool, `${prefix}:metrics:cleanup`, prefix);
      if (remaining.total !== 0) throw new Error(`Persisten ${remaining.total} jobs despues de limpiar`);
    } catch (error) {
      const cleanupEvidence = error && typeof error === "object" ? error.cleanupEvidence : null;
      if (cleanupEvidence) {
        console.log(JSON.stringify({ event: "queue_load_cleanup_result", cleanup: cleanupEvidence }));
      }
      primaryError = primaryError
        ? new AggregateError([primaryError, error], `Prueba y limpieza fallaron para ${prefix}`)
        : error;
    } finally {
      await Promise.all([webPool.end(), workerPool.end()]);
    }
  }

  if (primaryError) {
    console.log(JSON.stringify({ event: "queue_load_failure", runId, ...(cleanup ? { cleanup } : {}) }));
    throw primaryError;
  }
  if (cleanupOnly) {
    console.log(JSON.stringify({ passed: true, mode: "cleanup", runId, cleanup }));
    return;
  }
  result.cleanup = cleanup;
  if (cleanup.jobsDeleted !== jobsCount || cleanup.storesDeleted !== tenantsCount || cleanup.tenantsDeleted !== tenantsCount) {
    throw new Error(`Limpieza no verificable: ${JSON.stringify(cleanup)}`);
  }
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Prueba de capacidad no ejecutada: ${errorSummary(error)}`);
    process.exitCode = 2;
  });
}

module.exports = { assertAuthorized, normalizeRunId, percentile };
