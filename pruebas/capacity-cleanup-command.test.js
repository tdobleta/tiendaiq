"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCleanupCommand, syntheticTenantDomain, createCapacityCleanupHandler } = require("../src/capacity/cleanup-command");
const { command, cleanupRemote, ORIGIN } = require("../scripts/probar-limpieza-remota-capacidad");

test("el comando de cleanup sólo acepta el rango sintético explícito", () => {
  assert.deepEqual(parseCleanupCommand({ runId: "a1b2c3d4e5f6", tenants: 100 }), {
    runId: "a1b2c3d4e5f6",
    tenants: 100,
    prefix: "capacity-a1b2c3d4e5f6",
    anchorIndex: 1,
    anchorDomain: "capacity-a1b2c3d4e5f6-1.myshopify.com"
  });
  assert.throws(() => parseCleanupCommand({ runId: "../secreto", tenants: 1 }), /invalido/);
  assert.throws(() => parseCleanupCommand({ runId: "a1b2c3d4e5f6", tenants: 2001 }), /invalido/);
});

test("el handler del worker borra jobs y tenants por lotes, preservando su tenant-ancla", async () => {
  const calls = [];
  const deleted = [];
  const handler = createCapacityCleanupHandler({
    deleteJobs: async (...args) => { calls.push(args); return 7; },
    deleteTenant: async (domain) => { deleted.push(domain); },
    batchSize: 2
  });
  const result = await handler.run({ payload: { runId: "a1b2c3d4e5f6", tenants: 3 } }, { workerId: "worker-1" });
  assert.deepEqual(calls, [["capacity-a1b2c3d4e5f6", "worker-1"]]);
  assert.deepEqual(deleted, [
    "capacity-a1b2c3d4e5f6-2.myshopify.com",
    "capacity-a1b2c3d4e5f6-3.myshopify.com"
  ]);
  assert.deepEqual(result, {
    mode: "cleanup",
    runId: "a1b2c3d4e5f6",
    tenants: 3,
    jobsDeleted: 7,
    tenantCleanup: { batches: 1, tenantsProcessed: 2, anchorPending: 1 }
  });
});

test("el dominio sintético sólo puede derivarse dentro del rango declarado", () => {
  const command = parseCleanupCommand({ runId: "a1b2c3d4e5f6", tenants: 3 });
  assert.equal(syntheticTenantDomain(command, 2), "capacity-a1b2c3d4e5f6-2.myshopify.com");
  assert.throws(() => syntheticTenantDomain(command, 0), /invalido/);
  assert.throws(() => syntheticTenantDomain(command, 4), /invalido/);
});

test("un fallo reanudable vuelve a recorrer sólo el mismo rango estricto", async () => {
  const attempts = [];
  let failOnce = true;
  const handler = createCapacityCleanupHandler({
    deleteJobs: async () => 0,
    deleteTenant: async (domain) => {
      attempts.push(domain);
      if (domain.endsWith("-3.myshopify.com") && failOnce) {
        failOnce = false;
        throw new Error("transitorio");
      }
    },
    batchSize: 2
  });
  const job = { payload: { runId: "a1b2c3d4e5f6", tenants: 4 } };
  await assert.rejects(handler.run(job, { workerId: "worker-1" }), /transitorio/);
  const result = await handler.run(job, { workerId: "worker-1" });
  assert.deepEqual(attempts, [
    "capacity-a1b2c3d4e5f6-2.myshopify.com",
    "capacity-a1b2c3d4e5f6-3.myshopify.com",
    "capacity-a1b2c3d4e5f6-2.myshopify.com",
    "capacity-a1b2c3d4e5f6-3.myshopify.com",
    "capacity-a1b2c3d4e5f6-4.myshopify.com"
  ]);
  assert.equal(result.tenantCleanup.tenantsProcessed, 3);
  assert.equal(attempts.includes("capacity-a1b2c3d4e5f6-1.myshopify.com"), false);
});

test("el cliente remoto no contiene URL de base ni sigue redirecciones", async () => {
  const config = command({ LOAD_CLEANUP_RUN_ID: "a1b2c3d4e5f6", CLEANUP_TENANTS: "2", OPS_STATUS_TOKEN: "x".repeat(32) });
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return { status: 202, json: async () => ({ jobId: "12345678-1234-1234-1234-123456789abc" }) };
    return { status: 200, json: async () => ({ completed: true, tenantsDeleted: 2 }) };
  };
  await cleanupRemote(config, { fetchFn, sleep: async () => {} });
  assert.match(calls[0].url, new RegExp(`^${ORIGIN}`));
  assert.equal(calls[0].options.redirect, "error");
  assert.doesNotMatch(JSON.stringify(calls), /DATABASE_URL|postgres/i);
});
