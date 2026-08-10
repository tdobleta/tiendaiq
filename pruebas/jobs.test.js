"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { TenantContext } = require("../src/tenancy/tenant-context");
const { createJobRunner } = require("../src/jobs/job-runner");
const { boundedInteger } = require("../src/jobs/runtime");
const { createPublishPageHandler } = require("../src/jobs/publish-page-handler");

const tenant = TenantContext.fromShopDomain("jobs.myshopify.com", { source: "internal-job" });
const job = (overrides = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  tenantId: tenant.tenantId,
  tenant,
  type: "test-job",
  payload: {},
  status: "running",
  attempts: 1,
  maxAttempts: 3,
  lockedBy: "worker-1",
  ...overrides
});

describe("JobRunner", () => {
  test("completa un job y conserva el lease owner", async () => {
    const current = job();
    const calls = [];
    const runner = createJobRunner({
      workerId: "worker-1",
      repository: {
        async claim() { return current; },
        async succeed(context, claimed, result) {
          calls.push({ context, claimed, result });
          return { ...claimed, status: "succeeded" };
        },
        async fail() { throw new Error("no debía fallar"); }
      },
      handlers: { "test-job": { async run() { return { ok: true }; } } }
    });

    assert.equal(await runner.processOnce(), true);
    assert.equal(calls[0].claimed.lockedBy, "worker-1");
    assert.deepEqual(calls[0].result, { ok: true });
  });

  test("renueva el lease mientras un efecto externo sigue en curso", async () => {
    const current = job();
    let renewals = 0;
    let releaseWork;
    const work = new Promise((resolve) => { releaseWork = resolve; });
    const runner = createJobRunner({
      workerId: "worker-1",
      heartbeatMs: 5,
      repository: {
        async claim() { return current; },
        async renew(context, claimed) {
          renewals += 1;
          return { ...claimed, lockedAt: new Date().toISOString() };
        },
        async succeed(context, claimed) { return { ...claimed, status: "succeeded" }; },
        async fail() { throw new Error("no debía fallar"); }
      },
      handlers: {
        "test-job": { async run() { await work; } }
      }
    });

    const processing = runner.processOnce();
    const deadline = Date.now() + 250;
    while (renewals < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    releaseWork();
    await processing;
    assert.ok(renewals >= 2, `se esperaban al menos dos renovaciones, hubo ${renewals}`);
  });

  test("reintenta con backoff antes de agotar intentos", async () => {
    const current = job({ attempts: 1, maxAttempts: 3 });
    let failed;
    const runner = createJobRunner({
      workerId: "worker-1",
      repository: {
        async claim() { return current; },
        async succeed() { throw new Error("no debía completar"); },
        async fail(context, claimed, error, delay) {
          failed = { context, claimed, error, delay };
          return { ...claimed, status: "queued" };
        }
      },
      handlers: { "test-job": { async run() { throw new Error("Shopify temporal"); } } }
    });

    await runner.processOnce();
    assert.match(failed.error.message, /temporal/);
    assert.equal(failed.delay, 5);
  });

  test("un error no reintentable termina y ejecuta compensación", async () => {
    const current = job();
    let compensated = false;
    const runner = createJobRunner({
      workerId: "worker-1",
      repository: {
        async claim() { return current; },
        async succeed() { return null; },
        async fail(context, claimed) {
          assert.equal(claimed.attempts, claimed.maxAttempts);
          return { ...claimed, status: "failed" };
        }
      },
      handlers: {
        "test-job": {
          async run() {
            const error = new Error("payload inválido");
            error.nonRetryable = true;
            throw error;
          },
          async onTerminalFailure() { compensated = true; }
        }
      }
    });

    await runner.processOnce();
    assert.equal(compensated, true);
  });

  test("una compensación de cupo ocurre antes de cerrar el job terminal", async () => {
    const order = [];
    const current = job({ attempts: 3, maxAttempts: 3 });
    const runner = createJobRunner({
      workerId: "worker-1",
      repository: {
        async claim() { return current; },
        async succeed() {},
        async fail() { order.push("fail-job"); return { ...current, status: "failed" }; }
      },
      handlers: {
        "test-job": {
          compensateBeforeTerminal: true,
          async run() { throw new Error("IA agotada"); },
          async onTerminalFailure() { order.push("release-usage"); }
        }
      }
    });

    await runner.processOnce();
    assert.deepEqual(order, ["release-usage", "fail-job"]);
  });

  test("filtra el tipo de job asignado al carril", async () => {
    let requestedTypes;
    const runner = createJobRunner({
      workerId: "worker-generation-1",
      jobTypes: ["generate-page"],
      repository: {
        async claim(workerId, leaseSeconds, jobTypes) { requestedTypes = jobTypes; return null; },
        async succeed() {},
        async fail() {}
      },
      handlers: {}
    });

    assert.equal(await runner.processOnce(), false);
    assert.deepEqual(requestedTypes, ["generate-page"]);
  });

  test("stop espera a que termine el efecto externo activo", async () => {
    let release;
    let started;
    let claimed = false;
    const startedPromise = new Promise((resolve) => { started = resolve; });
    const work = new Promise((resolve) => { release = resolve; });
    const runner = createJobRunner({
      workerId: "worker-drain-1",
      pollMs: 5,
      repository: {
        async claim() {
          if (claimed) return null;
          claimed = true;
          return job();
        },
        async succeed(context, current) { return { ...current, status: "succeeded" }; },
        async fail() { throw new Error("no debia fallar"); }
      },
      handlers: {
        "test-job": {
          async run() {
            started();
            await work;
          }
        }
      }
    });

    runner.start();
    await startedPromise;
    let drained = false;
    const stopping = runner.stop().then(() => { drained = true; });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(drained, false);
    release();
    await stopping;
    assert.equal(drained, true);
  });
});

test("la configuracion de capacidad rechaza valores fuera de rango", () => {
  assert.equal(boundedInteger("8", 2), 8);
  assert.equal(boundedInteger("0", 2), 2);
  assert.equal(boundedInteger("100", 2), 2);
  assert.equal(boundedInteger("250", 1000, 50, 60000), 250);
});

describe("PublishPageHandler", () => {
  test("publica, persiste el resultado y limpia el job activo", async () => {
    const page = { id: "42", estado: "publicando", active_job_id: "job-1", data: { fuente: {} } };
    let saved;
    let metric;
    const handler = createPublishPageHandler({
      sessions: { async get() { return { tienda: tenant.tenantId, token: "token" }; } },
      pages: {
        async get() { return structuredClone(page); },
        async save(context, value) { saved = { context, value }; }
      },
      async publish() { return { url: "https://jobs.myshopify.com/products/demo" }; },
      metrics(name, props) { metric = { name, props }; }
    });

    const result = await handler.run(job({ id: "job-1", type: "publish-page", payload: { pageId: "42" } }));

    assert.equal(saved.value.estado, "publicada");
    assert.equal(saved.value.active_job_id, null);
    assert.equal(saved.value.url_publica, result.url);
    assert.equal(metric.name, "pagina_publicada");
  });

  test("conserva una edición que llega mientras Shopify está publicando", async () => {
    const before = { id: "42", estado: "publicando", active_job_id: "job-1", data: { titulo: "Original" } };
    const after = { ...structuredClone(before), data: { titulo: "Editado en otra pestaña" } };
    let reads = 0;
    let saved;
    const handler = createPublishPageHandler({
      sessions: { async get() { return { tienda: tenant.tenantId, token: "token" }; } },
      pages: {
        async get() { return structuredClone(reads++ === 0 ? before : after); },
        async save(context, value) { saved = value; }
      },
      async publish(data) {
        assert.equal(data.titulo, "Original", "el efecto remoto usa un snapshot estable");
        return { url: "https://jobs.myshopify.com/products/demo" };
      },
      metrics() {}
    });

    await handler.run(job({ id: "job-1", type: "publish-page", payload: { pageId: "42" } }));

    assert.equal(saved.data.titulo, "Editado en otra pestaña");
    assert.equal(saved.cambios_sin_publicar, true);
    assert.equal(saved.estado, "publicada");
  });

  test("el fallo terminal solo marca la página si el job sigue siendo el activo", async () => {
    const saves = [];
    const handler = createPublishPageHandler({
      sessions: { async get() { return {}; } },
      pages: {
        async get() { return { id: "42", estado: "publicando", active_job_id: "otro-job" }; },
        async save(context, value) { saves.push(value); }
      },
      async publish() { return {}; },
      metrics() {}
    });

    await handler.onTerminalFailure(job({ id: "job-viejo", type: "publish-page", payload: { pageId: "42" } }), new Error("falló"));
    assert.equal(saves.length, 0, "un worker viejo no puede pisar el estado de un job nuevo");
  });
});

test("la migración de jobs declara idempotencia y recuperación de leases", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "0003_durable_jobs.sql"), "utf8");
  const repository = fs.readFileSync(path.join(__dirname, "..", "src", "platform", "postgres", "job-repository.js"), "utf8");
  assert.match(sql, /jobs_tenant_idempotency_idx/);
  assert.match(repository, /FOR UPDATE SKIP LOCKED/);
  assert.match(repository, /SET locked_at = now\(\), updated_at = now\(\)/);
  assert.match(repository, /locked_by = \$4/);
  assert.match(repository, /locked_by = \$6/);
});

test("los jobs quedan aislados y el claim exige capacidad PostgreSQL de worker", () => {
  const tenantSql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "0004_jobs_rls.sql"), "utf8");
  const rolesSql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "0007_runtime_role_separation.sql"), "utf8");
  const repository = fs.readFileSync(path.join(__dirname, "..", "src", "platform", "postgres", "job-repository.js"), "utf8");
  assert.match(tenantSql, /ALTER TABLE control_plane\.jobs FORCE ROW LEVEL SECURITY/);
  assert.match(tenantSql, /tenant_id = current_setting\('app\.tenant_id', true\)/);
  assert.match(rolesSql, /pg_has_role\(session_user, 'tiendaiq_worker_capability', 'member'\)/);
  assert.doesNotMatch(rolesSql, /current_setting\('app\.worker_id'/);
  assert.match(repository, /set_config\('app\.worker_id', \$1, true\)/);
});
