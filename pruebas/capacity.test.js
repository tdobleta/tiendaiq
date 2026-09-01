"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createConcurrencyGate } = require("../src/capacity/concurrency-gate");

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
