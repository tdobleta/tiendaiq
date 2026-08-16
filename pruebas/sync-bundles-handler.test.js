"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSyncBundlesHandler } = require("../src/jobs/sync-bundles-handler");

const JOB = {
  id: "job-bundles-1",
  tenant: { tenantId: "prueba.myshopify.com" },
  tenantId: "prueba.myshopify.com",
  attempts: 1,
  payload: {
    requestId: "11111111-1111-4111-8111-111111111111",
    expectedVersion: 2,
    config: { lista: [{ id: "b_1", nombre: "Nueva" }] }
  }
};

function dependencies(overrides = {}) {
  const saved = [];
  const calls = { sessions: 0, deletes: 0, syncs: 0 };
  const current = {
    activo: true,
    lista: [{ id: "b_1", nombre: "Anterior", discount_ids: ["gid://viejo/1"] }],
    pending_cleanup_ids: [],
    version: 2,
    applied_version: 2,
    applied: { activo: true, lista: [{ id: "b_1", nombre: "Anterior" }], version: 2 },
    sync: null
  };
  const bundles = {
    async read() { return JSON.parse(JSON.stringify(current)); },
    prepare(actual, proposed) {
      return {
        ...JSON.parse(JSON.stringify(proposed)),
        activo: true,
        version: actual.version + 1,
        applied_version: actual.applied_version,
        applied: actual.applied,
        pending_cleanup_ids: [],
        sync: null
      };
    },
    async save(_tenant, config) { saved.push(JSON.parse(JSON.stringify(config))); },
    async deleteDiscounts() { calls.deletes += 1; return { borrados: [], fallidos: [] }; },
    async syncDiscounts(_session, config) {
      calls.syncs += 1;
      config.lista[0].discount_ids = ["gid://nuevo/1"];
      config.lista[0].sync_status = "active";
    },
    snapshot(config) {
      return {
        activo: config.activo,
        lista: JSON.parse(JSON.stringify(config.lista)),
        version: config.version
      };
    },
    ...overrides.bundles
  };
  return {
    saved,
    calls,
    handler: createSyncBundlesHandler({
      sessions: {
        async get() {
          calls.sessions += 1;
          return { tienda: JOB.tenantId, token: "token" };
        }
      },
      bundles,
      metrics: overrides.metrics || (() => {})
    })
  };
}

test("confirma la versión aplicada únicamente después de sincronizar Shopify", async () => {
  const { handler, saved, calls } = dependencies();

  const result = await handler.run(JOB);

  assert.equal(calls.sessions, 1);
  assert.equal(calls.deletes, 1);
  assert.equal(calls.syncs, 1);
  assert.equal(saved[0].sync.status, "running");
  assert.equal(saved[0].applied_version, 2);
  assert.equal(saved.at(-1).sync.status, "succeeded");
  assert.equal(saved.at(-1).applied_version, 3);
  assert.equal(saved.at(-1).applied.lista[0].discount_ids[0], "gid://nuevo/1");
  assert.equal(result.config.version, 3);
});

test("un resultado externo ambiguo no se reintenta a ciegas", async () => {
  const ambiguous = Object.assign(new Error("respuesta perdida"), { ambiguous: true });
  const { handler, saved, calls } = dependencies({
    bundles: { async syncDiscounts() { calls.syncs += 1; throw ambiguous; } }
  });

  await assert.rejects(
    () => handler.run(JOB),
    (error) => error.code === "BUNDLE_SYNC_AMBIGUOUS"
      && error.nonRetryable === true
      && error.ambiguous === true
  );

  assert.equal(calls.syncs, 1);
  assert.equal(saved.at(-1).sync.status, "manual_review");
  assert.equal(saved.at(-1).applied_version, 2);
});

test("un lease reclamado se marca para revisión sin volver a llamar a Shopify", async () => {
  const current = {
    activo: true,
    lista: [{ id: "b_1", discount_ids: ["gid://posible/1"] }],
    pending_cleanup_ids: [],
    version: 3,
    applied_version: 2,
    applied: { activo: true, lista: [], version: 2 },
    sync: { status: "running", request_id: JOB.payload.requestId, job_id: JOB.id }
  };
  const { handler, saved, calls } = dependencies({
    bundles: { async read() { return JSON.parse(JSON.stringify(current)); } }
  });

  await assert.rejects(
    () => handler.run({ ...JOB, attempts: 2 }),
    (error) => error.code === "BUNDLE_SYNC_AMBIGUOUS_RECLAIM" && error.nonRetryable === true
  );

  assert.equal(calls.sessions, 0);
  assert.equal(calls.deletes, 0);
  assert.equal(calls.syncs, 0);
  assert.equal(saved.at(-1).version, 3, "la recuperación no debe inventar otra versión");
  assert.equal(saved.at(-1).sync.status, "manual_review");
});

test("un job obsoleto falla antes de resolver sesión o tocar Shopify", async () => {
  const { handler, calls, saved } = dependencies();

  await assert.rejects(
    () => handler.run({
      ...JOB,
      payload: { ...JOB.payload, expectedVersion: 1 }
    }),
    (error) => error.code === "BUNDLE_SYNC_VERSION_CONFLICT" && error.nonRetryable === true
  );

  assert.equal(calls.sessions, 0);
  assert.equal(calls.deletes, 0);
  assert.equal(calls.syncs, 0);
  assert.equal(saved.length, 0);
});

test("un fallo de métricas no convierte una mutación confirmada en un job fallido", async () => {
  const { handler } = dependencies({ metrics() { throw new Error("monitor caído"); } });
  const result = await handler.run(JOB);
  assert.equal(result.config.sync.status, "succeeded");
});
