"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createConcurrencyGate } = require("../src/capacity/concurrency-gate");
const { assertAuthorized, normalizeRunId } = require("../scripts/probar-capacidad-cola");

test("la compuerta limita por tenant y globalmente", () => {
  const gate = createConcurrencyGate({ globalLimit: 2, perKeyLimit: 1 });
  const releaseA = gate.tryAcquire("a.myshopify.com");
  assert.equal(typeof releaseA, "function");
  assert.equal(gate.tryAcquire("a.myshopify.com"), null);
  const releaseB = gate.tryAcquire("b.myshopify.com");
  assert.equal(typeof releaseB, "function");
  assert.equal(gate.tryAcquire("c.myshopify.com"), null);
  assert.deepEqual(gate.snapshot(), { active: 2, globalLimit: 2, activeKeys: 2, perKeyLimit: 1 });

  releaseA();
  releaseA();
  const releaseC = gate.tryAcquire("c.myshopify.com");
  assert.equal(typeof releaseC, "function");
  releaseB();
  releaseC();
  assert.equal(gate.snapshot().active, 0);
});

test("la prueba de cola exige autorizacion adicional para un Postgres remoto", () => {
  const previous = process.env.ALLOW_REMOTE_QUEUE_LOAD_TEST;
  delete process.env.ALLOW_REMOTE_QUEUE_LOAD_TEST;
  try {
    assert.throws(
      () => assertAuthorized("postgresql://runtime@example.test/staging", "TEST_DATABASE_URL"),
      /Destino remoto bloqueado/
    );
    process.env.ALLOW_REMOTE_QUEUE_LOAD_TEST = "I_UNDERSTAND_THIS_WRITES_SYNTHETIC_STAGING_DATA";
    assert.doesNotThrow(
      () => assertAuthorized("postgresql://runtime@example.test/staging", "TEST_DATABASE_URL")
    );
  } finally {
    if (previous == null) delete process.env.ALLOW_REMOTE_QUEUE_LOAD_TEST;
    else process.env.ALLOW_REMOTE_QUEUE_LOAD_TEST = previous;
  }
});

test("la limpieza solo acepta el runId exacto emitido por la prueba", () => {
  assert.equal(normalizeRunId("A1B2C3D4E5F6"), "a1b2c3d4e5f6");
  for (const invalid of ["", "capacity-a1b2c3d4e5f6", "a1b2", "../../secreto", "g1b2c3d4e5f6"]) {
    assert.throws(() => normalizeRunId(invalid), /LOAD_CLEANUP_RUN_ID/);
  }
});
