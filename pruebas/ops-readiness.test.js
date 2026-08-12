"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertExpectedSha,
  evaluateQueue,
  evaluateReady,
  integer,
  normalizeAppUrl,
  summarizeQueue
} = require("../scripts/probar-readiness-operativa");

const SHA = "95a81bccac219b9355cf9adb4861a696d9b5caf3";

test("valida el SHA completo que debe responder staging", () => {
  assert.equal(assertExpectedSha(SHA.toUpperCase()), SHA);
  assert.throws(() => assertExpectedSha("95a81b"), /SHA completo/);
});

test("normaliza la URL de staging sin aceptar protocolos raros", () => {
  assert.equal(normalizeAppUrl("https://tiendaiq-staging-web.onrender.com/"), "https://tiendaiq-staging-web.onrender.com");
  assert.throws(() => normalizeAppUrl("file:///tmp/ready"), /http o https/);
});

test("evalua /ready con Postgres, release y aislamiento RLS", () => {
  const ready = {
    ok: true,
    release: SHA,
    almacenamiento: "postgres",
    aislamiento: {
      enabled: true,
      forced: true,
      protectedTables: 12,
      roleBypassesRls: false,
      inheritsRoles: false,
      workerCapability: false
    }
  };

  assert.deepEqual(evaluateReady(ready, SHA), { ok: true, errors: [] });
  assert.equal(evaluateReady({ ...ready, release: "0".repeat(40) }, SHA).ok, false);
  assert.equal(evaluateReady({ ...ready, aislamiento: { ...ready.aislamiento, workerCapability: true } }, SHA).ok, false);
});

test("resume la cola durable y aplica umbrales operativos", () => {
  const summary = summarizeQueue([
    { type: "generate-page", queued: 3, running: 2, failed: 1, oldestQueuedSeconds: 42.5 },
    { type: "publish-page", queued: 1, running: 0, failed: 0, oldestQueuedSeconds: 12 }
  ]);
  assert.deepEqual(summary, {
    types: 2,
    queued: 4,
    running: 2,
    failed: 1,
    oldestQueuedSeconds: 42.5
  });
  assert.deepEqual(evaluateQueue(summary, {
    maxOldestQueuedSeconds: 600,
    maxRunning: 10,
    maxFailed: 10
  }), { ok: true, errors: [] });
  assert.equal(evaluateQueue(summary, {
    maxOldestQueuedSeconds: 10,
    maxRunning: 10,
    maxFailed: 10
  }).ok, false);
});

test("parsea enteros de entorno con limites explicitos", () => {
  assert.equal(integer("", 600, 1, 1000, "X"), 600);
  assert.throws(() => integer("0", 600, 1, 1000, "X"), /X debe ser/);
  assert.throws(() => integer("1.5", 600, 1, 1000, "X"), /X debe ser/);
});
