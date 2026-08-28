"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCleanupCommand, createCapacityCleanupHandler } = require("../src/capacity/cleanup-command");
const { command, cleanupRemote, ORIGIN } = require("../scripts/probar-limpieza-remota-capacidad");

test("el comando de cleanup sólo acepta el rango sintético explícito", () => {
  assert.deepEqual(parseCleanupCommand({ runId: "a1b2c3d4e5f6", tenants: 100 }), {
    runId: "a1b2c3d4e5f6", tenants: 100, prefix: "capacity-a1b2c3d4e5f6"
  });
  assert.throws(() => parseCleanupCommand({ runId: "../secreto", tenants: 1 }), /invalido/);
  assert.throws(() => parseCleanupCommand({ runId: "a1b2c3d4e5f6", tenants: 2001 }), /invalido/);
});

test("el handler del worker borra sólo jobs capacity-probe bajo un prefijo validado", async () => {
  const calls = [];
  const handler = createCapacityCleanupHandler({ deleteJobs: async (...args) => { calls.push(args); return 7; } });
  const result = await handler.run({ payload: { runId: "a1b2c3d4e5f6", tenants: 3 } }, { workerId: "worker-1" });
  assert.deepEqual(calls, [["capacity-a1b2c3d4e5f6", "worker-1"]]);
  assert.deepEqual(result, { mode: "cleanup", runId: "a1b2c3d4e5f6", tenants: 3, jobsDeleted: 7 });
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
