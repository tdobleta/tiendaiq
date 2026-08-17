"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { TenantContext } = require("../src/tenancy/tenant-context");
const { LeaseLostError, createJobRunner: createJobRunnerBase, isNonRetryable, retryDelaySeconds } = require("../src/jobs/job-runner");
const { createCompensationRunner } = require("../src/jobs/compensation-runner");
const { parseRecoveryRequest } = require("../scripts/reencolar-compensacion");
const { boundedInteger } = require("../src/jobs/runtime");
const { createPublishPageHandler } = require("../src/jobs/publish-page-handler");
const { createUnpublishPageHandler } = require("../src/jobs/unpublish-page-handler");
const { createJobRepository } = require("../src/platform/postgres/job-repository");

const TEST_RELEASE_SHA = "a".repeat(40);

function createJobRunner(options) {
  return createJobRunnerBase({ releaseSha: TEST_RELEASE_SHA, ...options });
}

test("el runtime del worker forma parte del artefacto versionado", () => {
  const runtimePath = path.join(__dirname, "..", "src", "jobs", "runtime.js");
  assert.equal(fs.existsSync(runtimePath), true);
});

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
  workerReleaseSha: TEST_RELEASE_SHA,
  ...overrides
});

test("el runner falla cerrado sin un SHA de release completo", () => {
  const repository = { async claim() {}, async succeed() {}, async fail() {} };
  assert.throws(
    () => createJobRunnerBase({ workerId: "worker-1", repository, handlers: {} }),
    /releaseSha completo/
  );
  assert.throws(
    () => createJobRunnerBase({ workerId: "worker-1", releaseSha: "abc123", repository, handlers: {} }),
    /releaseSha completo/
  );
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
    assert.deepEqual(calls[0].result, { ok: true, _execution: { releaseSha: TEST_RELEASE_SHA } });
  });

  test("liga el resultado durable al release SHA que ejecuto el worker", async () => {
    const current = job();
    let persisted;
    const releaseSha = "a".repeat(40);
    const runner = createJobRunner({
      workerId: "worker-1",
      releaseSha,
      repository: {
        async claim() { return current; },
        async succeed(context, claimed, result) { persisted = result; return { ...claimed, status: "succeeded" }; },
        async fail() { throw new Error("no debia fallar"); }
      },
      handlers: {
        "test-job": {
          async run(currentJob, execution) {
            assert.equal(execution.releaseSha, releaseSha);
            return { ok: true, _execution: { releaseSha: "b".repeat(40) } };
          }
        }
      }
    });

    await runner.processOnce();
    assert.deepEqual(persisted, { ok: true, _execution: { releaseSha } });
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

  test("perder el lease aborta el handler y no completa ni reprograma el job", async () => {
    const current = job();
    const calls = [];
    const metrics = [];
    const runner = createJobRunner({
      workerId: "worker-1",
      heartbeatMs: 2,
      repository: {
        async claim() { return current; },
        async renew() { calls.push("renew"); return null; },
        async succeed() { calls.push("succeed"); return current; },
        async fail() { calls.push("fail"); return current; }
      },
      handlers: {
        "test-job": {
          async run(claimed, { signal }) {
            assert.equal(claimed, current);
            await new Promise((resolve, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            });
          },
          async onTerminalFailure() { calls.push("compensate"); }
        }
      },
      reportError() {},
      metrics(name) { metrics.push(name); }
    });

    assert.equal(await runner.processOnce(), true);
    assert.deepEqual(calls, ["renew"]);
    assert.deepEqual(metrics, ["job_lease_perdido"]);
  });

  test("una renovacion colgada vence, aborta el handler y no cierra el job", async () => {
    const current = job();
    const calls = [];
    const runner = createJobRunner({
      workerId: "worker-1",
      heartbeatMs: 2,
      repository: {
        async claim() { return current; },
        async renew() { calls.push("renew"); return new Promise(() => {}); },
        async succeed() { calls.push("succeed"); return current; },
        async fail() { calls.push("fail"); return current; }
      },
      handlers: {
        "test-job": {
          async run(claimed, { signal }) {
            assert.equal(claimed, current);
            await new Promise((resolve, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            });
          }
        }
      },
      reportError() {}
    });

    assert.equal(await runner.processOnce(), true);
    assert.ok(calls.length >= 1);
    assert.ok(calls.every((call) => call === "renew"));
  });

  test("un cierre rechazado por ownership no se convierte en un retry", async () => {
    const current = job();
    const calls = [];
    const runner = createJobRunner({
      workerId: "worker-1",
      repository: {
        async claim() { return current; },
        async succeed() { calls.push("succeed"); return null; },
        async fail() { calls.push("fail"); return current; }
      },
      handlers: { "test-job": { async run() { return { ok: true }; } } },
      reportError() {},
      metrics(name) { calls.push(name); }
    });

    assert.equal(await runner.processOnce(), true);
    assert.deepEqual(calls, ["succeed", "job_lease_perdido"]);
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

  test("una compensación de cupo ocurre solo después de cerrar el job terminal", async () => {
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
          async run() { throw new Error("IA agotada"); },
          async onTerminalFailure() { order.push("release-usage"); }
        }
      }
    });

    await runner.processOnce();
    assert.deepEqual(order, ["fail-job", "release-usage"]);
  });

  test("un repositorio durable encola la compensacion sin ejecutarla en el runner primario", async () => {
    const current = job({ attempts: 3, maxAttempts: 3 });
    let compensated = false;
    let requestedCompensation = false;
    const runner = createJobRunner({
      workerId: "worker-1",
      repository: {
        async claim() { return current; },
        async succeed() {},
        async fail(context, claimed, error, delay, needsCompensation) {
          requestedCompensation = needsCompensation;
          return { ...claimed, status: "failed", compensationStatus: "pending" };
        }
      },
      handlers: {
        "test-job": {
          async run() { throw new Error("IA agotada"); },
          async onTerminalFailure() { compensated = true; }
        }
      }
    });

    await runner.processOnce();
    assert.equal(requestedCompensation, true);
    assert.equal(compensated, false);
  });

  test("respeta Retry-After y limita esperas externas", () => {
    assert.equal(retryDelaySeconds({ retryAfter: 42 }, 1), 42);
    assert.equal(retryDelaySeconds({ retryAfter: 5000 }, 1), 900);
    assert.equal(retryDelaySeconds({}, 2), 10);
  });

  test("clasifica errores HTTP permanentes sin depender del proveedor", () => {
    assert.equal(isNonRetryable({ status: 422 }), true);
    assert.equal(isNonRetryable({ status: 429 }), false);
    assert.equal(isNonRetryable({ status: 503 }), false);
  });

  test("un error ambiguo puede impedir que se agende compensacion durable", async () => {
    const current = job();
    let requestedCompensation;
    const runner = createJobRunner({
      workerId: "worker-1",
      repository: {
        async claim() { return current; },
        async succeed() {},
        async fail(context, claimed, error, delay, needsCompensation) {
          requestedCompensation = needsCompensation;
          return { ...claimed, status: "failed" };
        }
      },
      handlers: {
        "test-job": {
          async run() {
            const error = new Error("resultado externo ambiguo");
            error.nonRetryable = true;
            error.skipCompensation = true;
            throw error;
          },
          needsCompensation(claimed, error) { return !error.skipCompensation; },
          async onTerminalFailure() { throw new Error("no debe compensar"); }
        }
      }
    });

    await runner.processOnce();
    assert.equal(requestedCompensation, false);
  });

  test("filtra el tipo de job asignado al carril", async () => {
    let requestedTypes;
    let requestedRelease;
    const runner = createJobRunner({
      workerId: "worker-generation-1",
      jobTypes: ["generate-page"],
      repository: {
        async claim(workerId, releaseSha, leaseSeconds, jobTypes) {
          requestedRelease = releaseSha;
          requestedTypes = jobTypes;
          return null;
        },
        async succeed() {},
        async fail() {}
      },
      handlers: {}
    });

    assert.equal(await runner.processOnce(), false);
    assert.equal(requestedRelease, TEST_RELEASE_SHA);
    assert.deepEqual(requestedTypes, ["generate-page"]);
  });

  test("stop aborta el handler activo con LeaseLostError y deja el lease recuperable", async () => {
    let started;
    let claimed = false;
    let abortReason;
    let succeeded = 0;
    let failed = 0;
    const startedPromise = new Promise((resolve) => { started = resolve; });
    const runner = createJobRunner({
      workerId: "worker-drain-1",
      pollMs: 5,
      shutdownTimeoutMs: 50,
      repository: {
        async claim() {
          if (claimed) return null;
          claimed = true;
          return job();
        },
        async succeed() { succeeded += 1; },
        async fail() { failed += 1; }
      },
      handlers: {
        "test-job": {
          async run(current, { signal }) {
            started();
            await new Promise((resolve) => signal.addEventListener("abort", () => {
              abortReason = signal.reason;
              resolve();
            }, { once: true }));
          }
        }
      },
      reportError() {}
    });

    runner.start();
    await startedPromise;
    await runner.stop();

    assert.ok(abortReason instanceof LeaseLostError);
    assert.equal(abortReason.code, "JOB_LEASE_LOST");
    assert.equal(succeeded, 0);
    assert.equal(failed, 0);
  });

  test("stop tiene plazo finito aunque el handler ignore la cancelacion", async () => {
    let started;
    let reason;
    const startedPromise = new Promise((resolve) => { started = resolve; });
    const reports = [];
    const runner = createJobRunner({
      workerId: "worker-blocked-1",
      pollMs: 5,
      shutdownTimeoutMs: 15,
      repository: {
        async claim() { return job(); },
        async succeed() { throw new Error("no debia completar"); },
        async fail() { throw new Error("no debia fallar"); }
      },
      handlers: {
        "test-job": {
          async run(current, { signal }) {
            signal.addEventListener("abort", () => { reason = signal.reason; }, { once: true });
            started();
            await new Promise(() => {});
          }
        }
      },
      reportError(error, context) { reports.push({ error, context }); }
    });

    runner.start();
    await startedPromise;
    const before = Date.now();
    await runner.stop();

    assert.ok(Date.now() - before < 250);
    assert.ok(reason instanceof LeaseLostError);
    assert.ok(reports.some(({ context }) => context.tipo === "worker-stop-timeout"));
  });

  test("stop tambien cancela una ejecucion iniciada con processOnce", async () => {
    let started;
    let reason;
    const startedPromise = new Promise((resolve) => { started = resolve; });
    const runner = createJobRunner({
      workerId: "worker-manual-1",
      shutdownTimeoutMs: 50,
      repository: {
        async claim() { return job(); },
        async succeed() { throw new Error("no debia completar"); },
        async fail() { throw new Error("no debia fallar"); }
      },
      handlers: {
        "test-job": {
          async run(current, { signal }) {
            started();
            await new Promise((resolve) => signal.addEventListener("abort", () => {
              reason = signal.reason;
              resolve();
            }, { once: true }));
          }
        }
      },
      reportError() {}
    });

    const processing = runner.processOnce();
    await startedPromise;
    await runner.stop();
    await processing;

    assert.ok(reason instanceof LeaseLostError);
    assert.equal(reason.code, "JOB_LEASE_LOST");
  });
});

describe("CompensationRunner", () => {
  test("recupera y confirma una limpieza terminal durable", async () => {
    const current = job({
      status: "failed",
      compensationStatus: "running",
      compensationAttempts: 1,
      compensationLockedBy: "worker-1:compensate"
    });
    const calls = [];
    const runner = createCompensationRunner({
      workerId: "worker-1:compensate",
      jobTypes: ["test-job"],
      repository: {
        async claimCompensation(workerId, leaseSeconds, jobTypes) {
          calls.push({ op: "claim", workerId, leaseSeconds, jobTypes });
          return current;
        },
        async renewCompensation() { return current; },
        async completeCompensation(context, claimed) {
          calls.push({ op: "complete", context, claimed });
          return { ...claimed, compensationStatus: "succeeded" };
        },
        async failCompensation() { throw new Error("no debia reprogramar"); }
      },
      handlers: {
        "test-job": {
          async onTerminalFailure(claimed, error) {
            calls.push({ op: "compensate", claimed, error });
          }
        }
      }
    });

    assert.equal(await runner.processOnce(), true);
    assert.deepEqual(calls.map(({ op }) => op), ["claim", "compensate", "complete"]);
    assert.deepEqual(calls[0].jobTypes, ["test-job"]);
    assert.match(calls[1].error.message, /Fallo terminal recuperado/);
  });

  test("reprograma con backoff una compensacion que vuelve a fallar", async () => {
    const current = job({
      status: "failed",
      compensationStatus: "running",
      compensationAttempts: 3,
      compensationLockedBy: "worker-1:compensate"
    });
    let retry;
    const runner = createCompensationRunner({
      workerId: "worker-1:compensate",
      repository: {
        async claimCompensation() { return current; },
        async renewCompensation() { return current; },
        async completeCompensation() { throw new Error("no debia completar"); },
        async failCompensation(context, claimed, error, delay, terminal) {
          retry = { context, claimed, error, delay, terminal };
          return { ...claimed, compensationStatus: "pending" };
        }
      },
      handlers: {
        "test-job": { async onTerminalFailure() { throw new Error("Postgres temporal"); } }
      },
      reportError() {}
    });

    assert.equal(await runner.processOnce(), true);
    assert.match(retry.error.message, /temporal/);
    assert.equal(retry.delay, 20);
    assert.equal(retry.terminal, false);
  });

  test("envia a cuarentena una compensacion que agota intentos", async () => {
    const current = job({ status: "failed", compensationStatus: "running", compensationAttempts: 4,
      compensationLockedBy: "worker-1:compensate" });
    let terminal;
    const runner = createCompensationRunner({
      workerId: "worker-1:compensate",
      maxAttempts: 4,
      repository: {
        async claimCompensation() { return current; },
        async renewCompensation() { return current; },
        async completeCompensation() { throw new Error("no debia completar"); },
        async failCompensation(context, claimed, error, delay, isTerminal) {
          terminal = isTerminal;
          return { ...claimed, compensationStatus: "dead_letter" };
        }
      },
      handlers: { "test-job": { async onTerminalFailure() { throw new Error("corrupcion persistente"); } } },
      reportError() {}
    });

    assert.equal(await runner.processOnce(), true);
    assert.equal(terminal, true);
  });

  test("perder el lease aborta la compensacion y no confirma ni reprograma", async () => {
    const current = job({ status: "failed", compensationStatus: "running", compensationAttempts: 1,
      compensationLockedBy: "worker-1:compensate" });
    let completed = 0;
    let failed = 0;
    const runner = createCompensationRunner({
      workerId: "worker-1:compensate",
      leaseSeconds: 30,
      heartbeatMs: 1,
      repository: {
        async claimCompensation() { return current; },
        async renewCompensation() { return null; },
        async completeCompensation() { completed += 1; },
        async failCompensation() { failed += 1; }
      },
      handlers: {
        "test-job": {
          async onTerminalFailure(claimed, error, { signal }) {
            await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
          }
        }
      },
      reportError() {}
    });

    assert.equal(await runner.processOnce(), true);
    assert.equal(completed, 0);
    assert.equal(failed, 0);
  });

  test("stop tiene plazo finito aunque una compensacion bloqueada ignore el aborto", async () => {
    const current = job({ status: "failed", compensationStatus: "running", compensationAttempts: 1,
      compensationLockedBy: "worker-stop:compensate" });
    let started;
    let abortReason;
    let completed = 0;
    let failed = 0;
    const startedPromise = new Promise((resolve) => { started = resolve; });
    const reports = [];
    const runner = createCompensationRunner({
      workerId: "worker-stop:compensate",
      pollMs: 5,
      shutdownTimeoutMs: 15,
      repository: {
        async claimCompensation() { return current; },
        async renewCompensation() { return current; },
        async completeCompensation() { completed += 1; },
        async failCompensation() { failed += 1; }
      },
      handlers: {
        "test-job": {
          async onTerminalFailure(claimed, error, { signal }) {
            signal.addEventListener("abort", () => { abortReason = signal.reason; }, { once: true });
            started();
            await new Promise(() => {});
          }
        }
      },
      reportError(error, context) { reports.push({ error, context }); }
    });

    runner.start();
    await startedPromise;
    const before = Date.now();
    await runner.stop();

    assert.ok(Date.now() - before < 250);
    assert.ok(abortReason instanceof LeaseLostError);
    assert.equal(abortReason.code, "JOB_LEASE_LOST");
    assert.equal(completed, 0);
    assert.equal(failed, 0);
    assert.ok(reports.some(({ context }) => context.tipo === "compensation-stop-timeout"));
  });
});

test("la configuracion de capacidad rechaza valores fuera de rango", () => {
  assert.equal(boundedInteger("8", 2), 8);
  assert.equal(boundedInteger("0", 2), 2);
  assert.equal(boundedInteger("100", 2), 2);
  assert.equal(boundedInteger("250", 1000, 50, 60000), 250);
});

describe("PublishPageHandler", () => {
  test("un replay completado no vuelve a abrir sesion ni tocar Shopify", async () => {
    let sessionReads = 0;
    let publishCalls = 0;
    const handler = createPublishPageHandler({
      sessions: { async get() { sessionReads += 1; return {}; } },
      pages: {
        async get() {
          return {
            id: "42",
            estado: "publicada",
            active_job_id: null,
            last_completed_job_id: "job-1",
            url_publica: "https://jobs.myshopify.com/products/demo",
            data: {}
          };
        }
      },
      async publish() { publishCalls += 1; return {}; }
    });

    const result = await handler.run(job({ id: "job-1", type: "publish-page", payload: { pageId: "42" } }));

    assert.equal(result.replayed, true);
    assert.equal(sessionReads, 0);
    assert.equal(publishCalls, 0);
  });

  test("un job reemplazado se detiene antes de abrir sesion o tocar Shopify", async () => {
    let sessionReads = 0;
    let publishCalls = 0;
    const handler = createPublishPageHandler({
      sessions: { async get() { sessionReads += 1; return {}; } },
      pages: {
        async get() {
          return { id: "42", estado: "publicando", active_job_id: "job-nuevo", data: {} };
        }
      },
      async publish() { publishCalls += 1; return {}; }
    });

    await assert.rejects(
      handler.run(job({ id: "job-viejo", type: "publish-page", payload: { pageId: "42" } })),
      (error) => error.code === "PUBLISH_JOB_SUPERSEDED" && error.nonRetryable === true
    );
    assert.equal(sessionReads, 0);
    assert.equal(publishCalls, 0);
    assert.equal(handler.needsCompensation({}, { skipCompensation: true }), false);
  });

  test("publica, persiste el resultado y limpia el job activo", async () => {
    const page = { id: "42", estado: "publicando", active_job_id: "job-1", data: { fuente: {} } };
    let saved;
    let metric;
    const handler = createPublishPageHandler({
      sessions: { async get() { return { tienda: tenant.tenantId, token: "token" }; } },
      pages: {
        async get() { return structuredClone(page); },
        async checkpointAvatar() {},
        async completePublication(context, pageId, activeJobId, result) {
          saved = {
            context,
            value: { ...structuredClone(page), estado: "publicada", active_job_id: null, url_publica: result.url }
          };
          return { page: saved.value };
        }
      },
      async publish() {
        return { url: "https://jobs.myshopify.com/products/demo", publishedHash: "b".repeat(64) };
      },
      metrics(name, props) { metric = { name, props }; }
    });

    const result = await handler.run(job({ id: "job-1", type: "publish-page", payload: { pageId: "42" } }));

    assert.equal(saved.value.estado, "publicada");
    assert.equal(saved.value.active_job_id, null);
    assert.equal(saved.value.url_publica, result.url);
    assert.equal(metric.name, "pagina_publicada");
  });

  test("falla cerrado si el publicador no confirma el hash exacto enviado a Shopify", async () => {
    let completions = 0;
    const handler = createPublishPageHandler({
      sessions: { async get() { return { tienda: tenant.tenantId, token: "token" }; } },
      pages: {
        async get() {
          return { id: "42", estado: "publicando", active_job_id: "job-1", data: { fuente: {} } };
        },
        async checkpointAvatar() {},
        async completePublication() { completions += 1; }
      },
      async publish() { return { url: "https://jobs.myshopify.com/products/demo" }; },
      metrics() {}
    });

    await assert.rejects(
      handler.run(job({ id: "job-1", type: "publish-page", payload: { pageId: "42" } })),
      (error) => error.nonRetryable === true && /hash exacto/.test(error.message)
    );
    assert.equal(completions, 0);
  });

  test("conserva una edición que llega mientras Shopify está publicando", async () => {
    const before = { id: "42", estado: "publicando", active_job_id: "job-1", data: { titulo: "Original" } };
    const after = { ...structuredClone(before), data: { titulo: "Editado en otra pestaña" } };
    let reads = 0;
    let saved;
    const handler = createPublishPageHandler({
      sessions: { async get() { return { tienda: tenant.tenantId, token: "token" }; } },
      pages: {
        async get() { return structuredClone(before); },
        async checkpointAvatar() {},
        async completePublication(context, pageId, activeJobId, result) {
          saved = { ...structuredClone(after), estado: "publicada", active_job_id: null, url_publica: result.url, cambios_sin_publicar: true };
          return { page: saved };
        }
      },
      async publish(data) {
        assert.equal(data.titulo, "Original", "el efecto remoto usa un snapshot estable");
        return { url: "https://jobs.myshopify.com/products/demo", publishedHash: "b".repeat(64) };
      },
      metrics() {}
    });

    await handler.run(job({ id: "job-1", type: "publish-page", payload: { pageId: "42" } }));

    assert.equal(saved.data.titulo, "Editado en otra pestaña");
    assert.equal(saved.cambios_sin_publicar, true);
    assert.equal(saved.estado, "publicada");
  });

  test("persiste la URL del avatar subida sin pisar otras ediciones", async () => {
    const review = (avatar, title) => ({
      facetas: { hero: { resena_destacada: { avatar, titulo: title } } }
    });
    const before = {
      id: "42",
      estado: "publicando",
      active_job_id: "job-1",
      data: review("data:image/png;base64,local", "Original")
    };
    const after = {
      ...structuredClone(before),
      data: review("data:image/png;base64,local", "Editado mientras publicaba")
    };
    let reads = 0;
    let saved;
    const handler = createPublishPageHandler({
      sessions: { async get() { return { tienda: tenant.tenantId, token: "token" }; } },
      pages: {
        async get() { return structuredClone(before); },
        async checkpointAvatar() {},
        async completePublication(context, pageId, activeJobId, result) {
          saved = structuredClone(after);
          saved.data.facetas.hero.resena_destacada.avatar = result.publishedAvatar;
          saved.estado = "publicada";
          saved.active_job_id = null;
          saved.cambios_sin_publicar = true;
          return { page: saved };
        }
      },
      async publish(data) {
        data.facetas.hero.resena_destacada.avatar = "https://cdn.shopify.com/avatar.png";
        return { url: "https://jobs.myshopify.com/products/demo", publishedHash: "b".repeat(64) };
      },
      metrics() {}
    });

    await handler.run(job({ id: "job-1", type: "publish-page", payload: { pageId: "42" } }));

    assert.equal(saved.data.facetas.hero.resena_destacada.avatar, "https://cdn.shopify.com/avatar.png");
    assert.equal(saved.data.facetas.hero.resena_destacada.titulo, "Editado mientras publicaba");
    assert.equal(saved.cambios_sin_publicar, true);
  });

  test("el fallo terminal solo marca la página si el job sigue siendo el activo", async () => {
    const calls = [];
    const handler = createPublishPageHandler({
      sessions: { async get() { return {}; } },
      pages: {
        async markPublicationFailed(context, pageId, activeJobId, message) {
          calls.push({ context, pageId, activeJobId, message });
          return null;
        }
      },
      async publish() { return {}; },
      metrics() {}
    });

    await handler.onTerminalFailure(job({ id: "job-viejo", type: "publish-page", payload: { pageId: "42" } }), new Error("falló"));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].activeJobId, "job-viejo");
    assert.equal(calls[0].pageId, "42");
  });
});

describe("UnpublishPageHandler", () => {
  test("despublica una vez y confirma el job activo", async () => {
    const page = {
      id: "42",
      estado: "despublicando",
      active_job_id: "job-1",
      last_completed_job_id: null,
      data: { shopify_product_id: "gid://shopify/Product/42" }
    };
    let unpublishCalls = 0;
    let completion;
    let metric;
    const handler = createUnpublishPageHandler({
      sessions: { async get() { return { tienda: tenant.tenantId, token: "token" }; } },
      pages: {
        async get() { return structuredClone(page); },
        async completeUnpublication(context, pageId, activeJobId) {
          completion = { context, pageId, activeJobId };
          return { page: { ...page, estado: "borrador", active_job_id: null } };
        }
      },
      async unpublish(data, session, options) {
        unpublishCalls += 1;
        assert.equal(data.shopify_product_id, "gid://shopify/Product/42");
        assert.equal(session.token, "token");
        assert.ok(options && Object.hasOwn(options, "signal"));
      },
      metrics(name, props) { metric = { name, props }; }
    });

    const result = await handler.run(job({ id: "job-1", type: "unpublish-page", payload: { pageId: "42" } }));

    assert.equal(unpublishCalls, 1);
    assert.equal(completion.pageId, "42");
    assert.equal(completion.activeJobId, "job-1");
    assert.equal(metric.name, "pagina_despublicada");
    assert.equal(result.replayed, false);
  });

  test("un replay completado no vuelve a abrir sesion ni tocar Shopify", async () => {
    let sessionReads = 0;
    let unpublishCalls = 0;
    const handler = createUnpublishPageHandler({
      sessions: { async get() { sessionReads += 1; return {}; } },
      pages: {
        async get() {
          return {
            id: "42",
            estado: "borrador",
            active_job_id: null,
            last_completed_job_id: "job-1",
            data: {}
          };
        }
      },
      async unpublish() { unpublishCalls += 1; }
    });

    const result = await handler.run(job({ id: "job-1", type: "unpublish-page", payload: { pageId: "42" } }));

    assert.equal(result.replayed, true);
    assert.equal(sessionReads, 0);
    assert.equal(unpublishCalls, 0);
  });
});

test("la migración de jobs declara idempotencia y recuperación de leases", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "0003_durable_jobs.sql"), "utf8");
  const repository = fs.readFileSync(path.join(__dirname, "..", "src", "platform", "postgres", "job-repository.js"), "utf8");
  assert.match(sql, /jobs_tenant_idempotency_idx/);
  assert.match(repository, /FOR UPDATE SKIP LOCKED/);
  assert.match(repository, /lease_expires_at = now\(\) \+ \(\$2::int \* interval '1 second'\)/);
  assert.match(repository, /locked_at \+ interval '1 hour',[\s\S]*'-infinity'::timestamptz/);
  assert.match(repository, /worker_release_sha = \$3/);
  assert.match(repository, /locked_by = \$4[\s\S]*worker_release_sha = \$5/);
  assert.match(repository, /locked_by = \$6[\s\S]*worker_release_sha = \$8/);
});

test("la compensacion terminal queda durable, reclamable y observable", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "0014_durable_job_compensation.sql"), "utf8");
  const repository = fs.readFileSync(path.join(__dirname, "..", "src", "platform", "postgres", "job-repository.js"), "utf8");
  const runtime = fs.readFileSync(path.join(__dirname, "..", "src", "jobs", "runtime.js"), "utf8");

  assert.match(sql, /compensation_status TEXT/);
  assert.match(sql, /sync_legacy_job_lease_expiry/);
  assert.match(sql, /SET lease_expires_at = locked_at \+ interval '1 hour'/);
  assert.match(sql, /SET compensation_lease_expires_at = compensation_locked_at \+ interval '1 hour'/);
  assert.match(sql, /'-infinity'::timestamptz/);
  assert.match(sql, /jobs_compensation_ready_idx/);
  assert.match(sql, /compensation_pending integer/);
  assert.match(sql, /oldest_compensation_seconds double precision/);
  assert.match(repository, /compensation_status = 'pending'/);
  assert.match(repository, /compensation_locked_by = \$3/);
  assert.match(runtime, /createCompensationRunner/);
  assert.match(runtime, /reclamarCompensacionJobDB/);
});

test("la recuperacion de una compensacion exige identidad, motivo y confirmacion explicitos", () => {
  const valid = {
    MIGRATION_DATABASE_URL: "postgresql://migrator:secret@db.example/tiendaiq",
    COMPENSATION_JOB_ID: "01234567-89ab-4def-8123-456789abcdef",
    COMPENSATION_RECOVERY_REASON: "Proveedor recuperado; reintento aprobado por operaciones.",
    COMPENSATION_RECOVERY_ACTOR: "operador@example.com",
    COMPENSATION_RECOVERY_SOURCE: "https://github.com/acme/tiendaiq/actions/runs/123",
    CONFIRMATION: "REQUEUE_ONE_COMPENSATION"
  };
  assert.equal(parseRecoveryRequest(valid).jobId, valid.COMPENSATION_JOB_ID);
  assert.throws(() => parseRecoveryRequest({ ...valid, CONFIRMATION: "yes" }), /Confirmacion/);
  assert.throws(() => parseRecoveryRequest({ ...valid, COMPENSATION_RECOVERY_REASON: "muy corto" }), /20 y 500/);
  assert.throws(() => parseRecoveryRequest({ ...valid, COMPENSATION_JOB_ID: "todos" }), /UUID/);
});

test("la recuperacion dead-letter es atomica, auditable y exclusiva del migrador", () => {
  const migration = fs.readFileSync(
    path.join(__dirname, "..", "db", "migrations", "0016_compensation_recovery_audit.sql"),
    "utf8"
  );
  const workflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "requeue-compensation-staging.yml"),
    "utf8"
  );

  assert.match(migration, /compensation_recovery_audit ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /compensation_recovery_audit FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /status = 'failed'[\s\S]*compensation_status = 'dead_letter'[\s\S]*FOR UPDATE/);
  assert.match(migration, /INSERT INTO control_plane\.compensation_recovery_audit/);
  assert.match(migration, /compensation_status = 'pending'/);
  assert.match(migration, /compensation_attempts = 0/);
  assert.match(migration, /GRANT EXECUTE[\s\S]*TO tiendaiq_migrator/);
  assert.doesNotMatch(migration, /GRANT EXECUTE[\s\S]*TO tiendaiq_(?:web|worker)(?:_runtime)?/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /REQUEUE_ONE_COMPENSATION/);
  assert.match(workflow, /STAGING_MIGRATION_DATABASE_URL/);
  assert.doesNotMatch(workflow, /STAGING_(?:WEB|WORKER)_DATABASE_URL/);
});

test("los jobs quedan aislados y el claim exige capacidad PostgreSQL de worker", () => {
  const tenantSql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "0004_jobs_rls.sql"), "utf8");
  const rolesSql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "0018_rotate_worker_capability.sql"), "utf8");
  const repository = fs.readFileSync(path.join(__dirname, "..", "src", "platform", "postgres", "job-repository.js"), "utf8");
  assert.match(tenantSql, /ALTER TABLE control_plane\.jobs FORCE ROW LEVEL SECURITY/);
  assert.match(tenantSql, /tenant_id = current_setting\('app\.tenant_id', true\)/);
  assert.match(rolesSql, /pg_has_role\(current_user, 'tiendaiq_worker_capability_v2', 'member'\)/);
  assert.doesNotMatch(rolesSql, /current_setting\('app\.worker_id'/);
  assert.match(repository, /set_config\('app\.worker_id', \$1, true\)/);
});

test("el estado operativo de jobs sale de una funcion agregada sin capacidad worker", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "0012_operational_queue_status.sql"), "utf8");
  const repository = fs.readFileSync(path.join(__dirname, "..", "src", "platform", "postgres", "job-repository.js"), "utf8");

  assert.match(sql, /CREATE OR REPLACE FUNCTION control_plane\.operational_queue_status\(\)/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /RETURNS TABLE \([\s\S]*type text[\s\S]*queued integer[\s\S]*oldest_queued_seconds double precision/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION control_plane\.operational_queue_status\(\)[\s\S]*TO tiendaiq_web_runtime, tiendaiq_worker_runtime/);
  assert.doesNotMatch(sql, /\btenant_id\b|\bidempotency_key\b|\blast_error\b/);
  assert.doesNotMatch(sql, /jobs\.payload/);
  assert.match(repository, /SELECT \* FROM control_plane\.operational_queue_status\(\)/);
});

test("el heartbeat operativo no expone datos tenant y restringe escritura al worker", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "db", "migrations", "0013_worker_heartbeat_and_queue_health.sql"),
    "utf8"
  );

  assert.match(sql, /CREATE TABLE IF NOT EXISTS control_plane\.worker_heartbeats/);
  assert.match(sql, /count\(DISTINCT active\.release_sha\)/);
  assert.match(sql, /last_seen_at >= statement_timestamp\(\) - interval '60 seconds'/);
  assert.match(sql, /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog, control_plane/);
  assert.match(sql, /REVOKE ALL ON TABLE control_plane\.worker_heartbeats[\s\S]*tiendaiq_worker_runtime/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION control_plane\.record_worker_heartbeat\(/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION control_plane\.record_worker_heartbeat\(text, text, integer, integer, integer\)[\s\S]*TO tiendaiq_worker_runtime/);
  assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE)[^;]*worker_heartbeats/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION control_plane\.operational_worker_status\(\)[\s\S]*TO tiendaiq_web_runtime, tiendaiq_worker_runtime/);
  assert.doesNotMatch(sql, /\btenant_id\b|\bshop\b|\bpayload\b/);
});

test("el repositorio persiste y proyecta heartbeat sin contexto tenant", async () => {
  const queries = [];
  const client = {
    async query(text, values) { queries.push({ text, values }); return { rows: [] }; },
    release() {}
  };
  const pool = {
    async connect() { return client; },
    async query(text, values) {
      queries.push({ text, values });
      return { rows: [{
        worker_id: "worker-1",
        release_sha: "a".repeat(40),
        runtime_role: "tiendaiq_worker_runtime",
        isolation_ok: true,
        generation_concurrency: 8,
        publication_concurrency: 4,
        webhook_concurrency: 2,
        age_seconds: 7,
        uptime_seconds: 40,
        active_workers: 1,
        release_variants: 1,
        runtime_role_variants: 1
      }] };
    }
  };
  const repository = createJobRepository(pool);
  await repository.recordHeartbeat({
    workerId: "worker-1",
    releaseSha: "a".repeat(40),
    runtimeRole: "tiendaiq_worker_runtime",
    isolationOk: true,
    capacity: { generations: 8, publications: 4, webhooks: 2 }
  });
  const heartbeat = queries.find(({ text }) => /record_worker_heartbeat/.test(text));
  assert.deepEqual(heartbeat.values, ["worker-1", "a".repeat(40), 8, 4, 2]);
  assert.doesNotMatch(heartbeat.text, /tenant_id|payload|INSERT|DELETE|UPDATE/);

  const status = await repository.workerStatus();
  assert.equal(status.release, "a".repeat(40));
  assert.equal(status.runtimeRole, "tiendaiq_worker_runtime");
  assert.equal(status.ageSeconds, 7);
  assert.equal(status.uptimeSeconds, 40);
  assert.equal(status.activeWorkers, 1);
  assert.equal(status.releaseVariants, 1);
  assert.equal(status.runtimeRoleVariants, 1);
});

test("el repositorio rechaza un heartbeat ambiguo antes de abrir una conexion", async () => {
  let connections = 0;
  const repository = createJobRepository({
    async connect() { connections += 1; throw new Error("no debe conectar"); }
  });
  await assert.rejects(
    repository.recordHeartbeat({
      workerId: "worker-1",
      releaseSha: "main",
      runtimeRole: "tiendaiq_worker_runtime",
      isolationOk: true,
      capacity: { generations: 8, publications: 4, webhooks: 2 }
    }),
    /SHA completo/
  );
  assert.equal(connections, 0);
});

test("los workflows que operan staging fijan las acciones que ejecutan", () => {
  const workflows = [
    "release-staging.yml",
    "ops-readiness-staging.yml",
    "capacity-staging.yml",
    "anthropic-capacity-staging.yml",
    "shopify-e2e-staging.yml",
    "requeue-compensation-staging.yml"
  ];

  for (const name of workflows) {
    const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", name), "utf8");
    assert.match(workflow, /environment: staging/, name);
    assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/, name);
    assert.match(workflow, /actions\/setup-node@[a-f0-9]{40}/, name);
    assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node)@v\d/, name);
  }
});

test("la evidencia Shopify de staging usa solo el token operativo y un SHA revisado", () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "shopify-e2e-staging.yml"),
    "utf8"
  );

  assert.match(workflow, /release_sha:/);
  assert.match(workflow, /VERIFY_SHOPIFY_STAGING_E2E/);
  assert.match(workflow, /ref: \$\{\{ inputs\.release_sha \}\}/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /STAGING_OPS_STATUS_TOKEN/);
  assert.match(workflow, /\/ops\/shopify-certification/);
  assert.match(workflow, /verificar-certificacion-shopify-staging\.js/);
  assert.doesNotMatch(workflow, /STAGING_MIGRATION_DATABASE_URL/);
  assert.doesNotMatch(workflow, /MIGRATION_DATABASE_URL/);
  assert.doesNotMatch(workflow, /TOKEN_ENC_KEY/);
  assert.doesNotMatch(workflow, /SHOPIFY_(?:TOKEN|ACCESS_TOKEN)/);
  assert.doesNotMatch(workflow, /RENDER_(?:STAGING_)?(?:WEB|WORKER)_DEPLOY_HOOK/);
});

test("los workflows de produccion fijan acciones y usan entornos protegidos", () => {
  const workflows = [
    ["release-production.yml", "production"],
    ["bootstrap-runtime-logins-production.yml", "production"],
    ["recover-production.yml", "production-recovery"]
  ];

  for (const [name, environment] of workflows) {
    const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", name), "utf8");
    assert.match(workflow, new RegExp(`environment: ${environment}`), name);
    assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/, name);
    assert.match(workflow, /actions\/setup-node@[a-f0-9]{40}/, name);
    assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node)@v\d/, name);
  }
});

test("todos los workflows del candado de produccion conservan la cola pendiente", () => {
  const workflows = [
    "release-production.yml",
    "recover-production.yml",
    "bootstrap-runtime-logins-production.yml"
  ];

  for (const name of workflows) {
    const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", name), "utf8");
    assert.match(workflow, /group: tiendaiq-production-database-maintenance/, name);
    assert.match(workflow, /queue: max/, name);
    assert.match(workflow, /cancel-in-progress: false/, name);
  }
});

test("el release de produccion persiste un rollback antes de desplegar el SHA revisado", () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "release-production.yml"),
    "utf8"
  );

  assert.match(workflow, /release_sha:/);
  assert.match(workflow, /DEPLOY_REVIEWED_PRODUCTION/);
  assert.match(workflow, /MIGRATIONS_ARE_BACKWARD_COMPATIBLE/);
  assert.match(workflow, /ALLOW_NO_PREVIOUS_RELEASE/);
  assert.match(workflow, /ref: \$\{\{ inputs\.release_sha \}\}/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /PRODUCTION_MIGRATION_DATABASE_URL/);
  assert.match(workflow, /RENDER_PRODUCTION_WEB_DEPLOY_HOOK/);
  assert.match(workflow, /RENDER_PRODUCTION_WORKER_DEPLOY_HOOK/);
  assert.match(workflow, /https:\/\/tiendaiq\.com\/ready/);
  assert.match(workflow, /OPS_APP_URL: https:\/\/tiendaiq\.com/);
  assert.match(workflow, /CHECK_PRODUCTION_OPS_READINESS/);
  assert.match(workflow, /PRODUCTION_OPS_STATUS_TOKEN/);
  assert.match(workflow, /ready\.ok===true&&ready\.release===process\.env\.EXPECTED_SHA/);
  assert.match(workflow, /group: tiendaiq-production-database-maintenance/);
  assert.match(workflow, /queue: max/);
  assert.doesNotMatch(workflow, /WEB_RUNTIME_LOGIN_PASSWORD/);
  assert.doesNotMatch(workflow, /WORKER_RUNTIME_LOGIN_PASSWORD/);
  assert.doesNotMatch(workflow, /preparar-roles-runtime/);
  assert.match(workflow, /id: previous/);
  assert.match(workflow, /steps\.previous\.outputs\.sha/);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.match(workflow, /Prepare the durable application rollback state/);
  assert.match(workflow, /production-rollback-state\/state\.json/);
  assert.match(workflow, /actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /name: production-rollback-state-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /run_attempt:Number\(process\.env\.RELEASE_ATTEMPT\)/);
  assert.match(workflow, /retention-days: 1/);
  assert.match(workflow, /--connect-timeout 5 --max-time 20/);
  assert.match(workflow, /OPS_READINESS_PROFILE: technical_preflight/);
  assert.doesNotMatch(workflow, /rollback-production:/);
  assert.doesNotMatch(workflow, /complete production operational release gate/);

  const captureIndex = workflow.indexOf("id: previous");
  const migrationIndex = workflow.indexOf("Migrate production with the owner credential");
  const rollbackStateIndex = workflow.indexOf("Prepare the durable application rollback state");
  const deployIndex = workflow.indexOf("id: deploy_web");

  assert.ok(captureIndex >= 0 && captureIndex < migrationIndex, "captura el release anterior antes de migrar");
  assert.ok(migrationIndex < rollbackStateIndex, "migra antes de fijar el estado recuperable");
  assert.ok(rollbackStateIndex < deployIndex, "persiste el estado antes de desplegar aplicaciones");
});

test("la recuperacion de produccion restaura y certifica web y worker fuera del release fallido", () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "recover-production.yml"),
    "utf8"
  );

  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \["Release production"\]/);
  assert.match(workflow, /types: \[completed\]/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'workflow_dispatch'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'failure'/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'cancelled'/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'timed_out'/);
  assert.match(workflow, /group: tiendaiq-production-database-maintenance/);
  assert.match(workflow, /queue: max/);
  assert.match(workflow, /environment: production-recovery/);
  assert.match(workflow, /timeout-minutes: 25/);
  assert.match(workflow, /actions\/download-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /name: production-rollback-state-\$\{\{ github\.event\.workflow_run\.run_attempt \}\}/);
  assert.match(workflow, /--retry 3 --retry-delay 2 --retry-all-errors/);
  assert.match(workflow, /jobs\?filter=latest&per_page=100/);
  assert.match(workflow, /Deploy web after a successful migration/);
  assert.match(workflow, /Deploy worker after a successful migration/);
  assert.match(workflow, /un deploy de aplicacion comenzo pero falta el estado de rollback/);
  assert.match(workflow, /No se inicio ningun deploy de aplicacion; no hay rollback que ejecutar/);
  assert.match(workflow, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(workflow, /state\.release_sha !== process\.env\.TRIGGER_SHA/);
  assert.match(workflow, /state\.run_attempt !== Number\(process\.env\.TRIGGER_ATTEMPT\)/);
  assert.match(workflow, /Request rollback for web and worker before installing tooling/);
  assert.match(workflow, /--connect-timeout 5 --max-time 20/);
  assert.match(workflow, /data-urlencode "ref=\$PREVIOUS_SHA"/);
  assert.match(workflow, /trigger_rollback web/);
  assert.match(workflow, /trigger_rollback worker/);
  assert.match(workflow, /web_hook_failed=0/);
  assert.match(workflow, /worker_hook_failed=0/);
  assert.match(workflow, /PRODUCTION_OPS_STATUS_TOKEN/);
  assert.match(workflow, /EXPECTED_RELEASE_SHA: \$\{\{ steps\.state\.outputs\.previous_sha \}\}/);
  assert.match(workflow, /OPS_READINESS_PROFILE: rollback/);
  assert.match(workflow, /Rollback certificado: web y worker ejecutan \$PREVIOUS_SHA/);
  assert.match(workflow, /ROLLBACK_READINESS_DEADLINE_SECONDS: "900"/);
  assert.match(workflow, /deadline=\$\(\(SECONDS \+ ROLLBACK_READINESS_DEADLINE_SECONDS\)\)/);
  assert.match(workflow, /timeout "\$\{remaining\}s" npm run ops:readiness/);
  assert.doesNotMatch(workflow, /PRODUCTION_MIGRATION_DATABASE_URL/);

  const hookIndex = workflow.indexOf("Request rollback for web and worker before installing tooling");
  const installIndex = workflow.indexOf("npm ci --no-audit --no-fund");
  assert.ok(hookIndex >= 0 && hookIndex < installIndex, "los hooks se disparan antes de depender de npm");

  const rollbackTimeoutMinutes = Number(workflow.match(/recover-production:[\s\S]*?timeout-minutes: (\d+)/)?.[1]);
  const readinessDeadlineSeconds = Number(workflow.match(/ROLLBACK_READINESS_DEADLINE_SECONDS: "(\d+)"/)?.[1]);
  assert.ok(readinessDeadlineSeconds <= (rollbackTimeoutMinutes * 60) - 300,
    "la recuperacion reserva al menos cinco minutos para hooks e instalacion");
});

test("las pruebas de capacidad se atan al SHA revisado y desplegado", () => {
  const workflows = ["capacity-staging.yml", "anthropic-capacity-staging.yml"];

  for (const name of workflows) {
    const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", name), "utf8");
    assert.match(workflow, /release_sha:/, name);
    assert.match(workflow, /ref: \$\{\{ inputs\.release_sha \}\}/, name);
    assert.match(workflow, /fetch-depth: 0/, name);
    assert.match(workflow, /git fetch origin main --depth=1/, name);
    assert.match(workflow, /git rev-parse origin\/main/, name);
    assert.match(workflow, /EXPECTED_RELEASE_SHA/, name);
    assert.match(workflow, /https:\/\/tiendaiq-staging-web\.onrender\.com\/ready/, name);
    assert.match(workflow, /ready\.ok===true&&ready\.release===process\.env\.EXPECTED_RELEASE_SHA/, name);
    assert.match(workflow, /npm ci --no-audit --no-fund/, name);
  }

  const queueCapacityWorkflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "capacity-staging.yml"),
    "utf8"
  );
  assert.match(queueCapacityWorkflow, /EXPECTED_RELEASE_SHA: \$\{\{ inputs\.release_sha \}\}[\s\S]{0,500}npm run carga:cola/);
});
