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

async function main() {
  if (process.env.ALLOW_QUEUE_LOAD_TEST !== "1") {
    throw new Error("Defina ALLOW_QUEUE_LOAD_TEST=1 para autorizar datos sinteticos desechables");
  }

  const webUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  const workerUrl = process.env.TEST_WORKER_DATABASE_URL;
  assertAuthorized(webUrl, "TEST_DATABASE_URL");
  assertAuthorized(workerUrl, "TEST_WORKER_DATABASE_URL");

  const tenantsCount = integer(process.env.LOAD_TENANTS, 1000, 1, 2000, "LOAD_TENANTS");
  const jobsCount = integer(process.env.LOAD_JOBS, 1000, 1, 2000, "LOAD_JOBS");
  const setupConcurrency = integer(process.env.LOAD_SETUP_CONCURRENCY, 40, 1, 100, "LOAD_SETUP_CONCURRENCY");
  const workerLanes = integer(process.env.LOAD_WORKER_LANES, 16, 1, 32, "LOAD_WORKER_LANES");
  const fakeWorkMs = integer(process.env.LOAD_FAKE_WORK_MS, 5, 0, 5000, "LOAD_FAKE_WORK_MS");
  const maxDrainSeconds = integer(process.env.LOAD_MAX_DRAIN_SECONDS, 900, 1, 3600, "LOAD_MAX_DRAIN_SECONDS");
  const runId = crypto.randomBytes(6).toString("hex");
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
  const webJobs = createJobRepository(webPool);
  const workerJobs = createJobRepository(workerPool);
  const enqueueLatencies = [];
  let processed = 0;
  let processError = null;

  try {
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

    const drainStarted = performance.now();
    async function lane(index) {
      while (!processError) {
        const current = await workerJobs.claim(`${prefix}:worker:${index}`, 120, ["capacity-probe"]);
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

    const result = {
      passed: drainMs / 1000 <= maxDrainSeconds,
      runId,
      tenants: tenantsCount,
      jobs: jobsCount,
      workerLanes,
      fakeWorkMs,
      setupMs,
      enqueueMs,
      enqueueP95Ms: percentile(enqueueLatencies, 0.95),
      drainMs,
      jobsPerSecond: jobsCount / Math.max(0.001, drainMs / 1000),
      maxDrainSeconds,
      webPoolPeak: webPool.totalCount,
      workerPoolPeak: workerPool.totalCount
    };
    console.log(JSON.stringify(result));
    if (!result.passed) process.exitCode = 1;
  } finally {
    try {
      const cleanup = await workerPool.connect();
      try {
        await cleanup.query("BEGIN");
        await cleanup.query("SELECT set_config('app.worker_id', $1, true)", [`${prefix}:cleanup`]);
        await cleanup.query(
          "DELETE FROM control_plane.jobs WHERE type = 'capacity-probe' AND idempotency_key LIKE $1",
          [`${prefix}:%`]
        );
        await cleanup.query("COMMIT");
      } catch (error) {
        await cleanup.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        cleanup.release();
      }
      await parallelMap(tenants, setupConcurrency, (tenant) =>
        withTenantTransaction(webPool, tenant, async (client) => {
          await client.query("DELETE FROM public.tiendas WHERE dominio = $1", [tenant.tenantId]);
          await client.query("DELETE FROM control_plane.tenants WHERE id = $1", [tenant.tenantId]);
        })
      );
    } finally {
      await Promise.all([webPool.end(), workerPool.end()]);
    }
  }
}

main().catch((error) => {
  console.error(`Prueba de capacidad no ejecutada: ${error.message}`);
  process.exitCode = 2;
});
