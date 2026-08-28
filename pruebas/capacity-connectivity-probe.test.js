"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { probeConnection, reviewedSha } = require("../scripts/probar-conexiones-capacidad");

test("el probe usa una única consulta de sólo lectura", async () => {
  const calls = [];
  const result = await probeConnection({
    async connect() {
      return {
        async query(sql) { calls.push(sql); },
        release() { calls.push("RELEASE"); }
      };
    }
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["SELECT 1", "RELEASE"]);
});

test("el probe expone sólo diagnóstico acotado de una conexión fallida", async () => {
  const result = await probeConnection({
    async connect() { throw { code: "42501", message: "password=must-not-appear" }; }
  });
  assert.deepEqual(result, {
    ok: false,
    failureClass: "authorization",
    failureOrigin: "postgres",
    failureStage: "connect"
  });
  assert.doesNotMatch(JSON.stringify(result), /password|must-not-appear|42501/i);
});

test("el probe exige un SHA revisado", () => {
  assert.equal(reviewedSha("a".repeat(40)), "a".repeat(40));
  assert.throws(() => reviewedSha("short"), /SHA completo/);
});
