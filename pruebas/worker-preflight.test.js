"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { iniciarWorker } = require("../worker");

test("el worker no crea ni inicia runners antes de aprobar el preflight", async () => {
  const events = [];
  const runtime = await iniciarWorker({
    async verificar() { events.push("verified"); },
    crearRuntime() {
      events.push("created");
      return { start() { events.push("started"); } };
    }
  });

  assert.deepEqual(events, ["verified", "created", "started"]);
  assert.equal(typeof runtime.start, "function");
});

test("el worker queda detenido cuando falla el preflight", async () => {
  let created = false;
  await assert.rejects(
    iniciarWorker({
      async verificar() { throw new Error("rol incorrecto"); },
      crearRuntime() {
        created = true;
        return { start() {} };
      }
    }),
    /rol incorrecto/
  );
  assert.equal(created, false);
});
