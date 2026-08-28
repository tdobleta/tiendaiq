"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { probeRuntimeStatus, probeFromOperationalStatus, reviewedSha } = require("../scripts/probar-conexiones-capacidad");

const RELEASE = "a".repeat(40);
const TOKEN = "token-ops-status-de-prueba-con-largo-suficiente";

test("el probe usa el estado operativo autenticado, no una URL de PostgreSQL del runner", async () => {
  const calls = [];
  const result = await probeRuntimeStatus({
    token: TOKEN,
    release: RELEASE,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            release: RELEASE,
            worker: { release: RELEASE, runtimeRole: "tiendaiq_worker_runtime", isolationOk: true, activeWorkers: 1 }
          };
        }
      };
    }
  });
  assert.deepEqual(result, { web: { ok: true }, worker: { ok: true } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://tiendaiq-partner-staging-web.onrender.com/ops/status");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${TOKEN}`);
});

test("el probe solo expone una taxonomia acotada si el worker no confirma runtime", () => {
  const result = probeFromOperationalStatus({
    ok: true,
    release: RELEASE,
    worker: { release: "other", runtimeRole: "tiendaiq_worker_runtime", isolationOk: true, activeWorkers: 1, raw: "must-not-appear" }
  }, RELEASE);
  assert.deepEqual(result, {
    web: { ok: true },
    worker: { ok: false, failureClass: "connection", failureOrigin: "runtime", failureStage: "ops_status" }
  });
  assert.doesNotMatch(JSON.stringify(result), /raw|must-not-appear|other/i);
});

test("el probe exige un SHA revisado", () => {
  assert.equal(reviewedSha(RELEASE), RELEASE);
  assert.throws(() => reviewedSha("short"), /SHA completo/);
});
