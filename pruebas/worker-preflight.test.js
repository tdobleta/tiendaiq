"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { identidadWorker, iniciarWorker } = require("../worker");

const SHA = "95a81bccac219b9355cf9adb4861a696d9b5caf3";
const RUNTIME_ENV = {
  RENDER_GIT_COMMIT: SHA,
  PG_RUNTIME_ROLE: "tiendaiq_worker_runtime",
  JOB_GENERATION_CONCURRENCY: "8",
  JOB_PUBLICATION_CONCURRENCY: "4",
  WEBHOOK_CONCURRENCY: "2"
};

test("el worker no crea ni inicia runners antes de aprobar el preflight", async () => {
  const events = [];
  const runtime = await iniciarWorker({
    runtimeEnv: RUNTIME_ENV,
    async verificar() {
      events.push("verified");
      return { tipo: "postgres", aislamiento: { forced: true, workerCapability: true } };
    },
    async registrarHeartbeat(heartbeat) {
      events.push("heartbeat");
      assert.equal(heartbeat.releaseSha, SHA);
      assert.equal(heartbeat.isolationOk, true);
    },
    crearRuntime(options) {
      events.push("created");
      assert.equal(options.generationConcurrency, 8);
      return { start() { events.push("started"); }, async stop() {} };
    },
    setIntervalFn() { return { unref() {} }; }
  });

  assert.deepEqual(events, ["verified", "created", "started", "heartbeat"]);
  assert.equal(typeof runtime.start, "function");
  await runtime.stop();
});

test("el worker queda detenido cuando falla el preflight", async () => {
  let created = false;
  await assert.rejects(
    iniciarWorker({
      async verificar() { throw new Error("rol incorrecto"); },
      runtimeEnv: RUNTIME_ENV,
      async registrarHeartbeat() {},
      crearRuntime() {
        created = true;
        return { start() {} };
      }
    }),
    /rol incorrecto/
  );
  assert.equal(created, false);
});

test("el worker rechaza releases sin SHA inmutable", () => {
  assert.throws(
    () => identidadWorker({ PG_RUNTIME_ROLE: "tiendaiq_worker_runtime" }),
    /SHA completo/
  );
});

test("el worker exige el rol runtime aislado", () => {
  assert.throws(
    () => identidadWorker({ ...RUNTIME_ENV, PG_RUNTIME_ROLE: "tiendaiq_worker" }),
    /tiendaiq_worker_runtime/
  );
});

test("cada arranque del worker obtiene una identidad distinta", () => {
  const first = identidadWorker(RUNTIME_ENV);
  const second = identidadWorker(RUNTIME_ENV);

  assert.notEqual(first.workerId, second.workerId);
  assert.match(first.workerId, /:[0-9a-f-]{36}$/);
});

test("el worker no arranca si el preflight no demuestra aislamiento", async () => {
  let heartbeat = false;
  let created = false;
  await assert.rejects(
    iniciarWorker({
      runtimeEnv: RUNTIME_ENV,
      async verificar() {
        return { tipo: "postgres", aislamiento: { forced: true, workerCapability: false } };
      },
      async registrarHeartbeat() { heartbeat = true; },
      crearRuntime() { created = true; return { start() {}, async stop() {} }; }
    }),
    /aislamiento RLS forzado/
  );
  assert.equal(heartbeat, false);
  assert.equal(created, false);
});

test("tres heartbeats fallidos drenan el runtime y terminan el proceso", async () => {
  let intervalCallback;
  let heartbeatCalls = 0;
  let stopped = 0;
  let closed = 0;
  let exitCode = null;
  const runtime = await iniciarWorker({
    runtimeEnv: RUNTIME_ENV,
    async verificar() {
      return { tipo: "postgres", aislamiento: { forced: true, workerCapability: true } };
    },
    async registrarHeartbeat() {
      heartbeatCalls += 1;
      if (heartbeatCalls > 1) throw new Error("postgres no disponible");
    },
    crearRuntime() {
      return { start() {}, async stop() { stopped += 1; } };
    },
    setIntervalFn(callback) {
      intervalCallback = callback;
      return { unref() {} };
    },
    reportar() {},
    async cerrarAlmacenamiento() { closed += 1; },
    terminate(code) { exitCode = code; }
  });

  await intervalCallback();
  await intervalCallback();
  await intervalCallback();

  assert.equal(stopped, 1);
  assert.equal(closed, 1);
  assert.equal(exitCode, 1);
  await runtime.stop();
});
