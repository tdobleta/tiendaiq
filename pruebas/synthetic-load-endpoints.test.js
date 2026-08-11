"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSyntheticLoadHandler } = require("../src/capacity/synthetic-load-endpoints");

const TOKEN = "load-test-token-" + "x".repeat(32);
const NOW = Date.parse("2026-08-11T12:00:00.000Z");
const EXPIRES_AT = "2026-08-11T13:00:00.000Z";

function createHandler(overrides = {}) {
  return createSyntheticLoadHandler({
    enabled: "1",
    environment: "staging",
    token: TOKEN,
    expiresAt: EXPIRES_AT,
    readJson: async () => ({}),
    now: () => NOW,
    ...overrides
  });
}

function responseRecorder() {
  return {
    status: null,
    headers: {},
    body: "",
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = headers;
      return this;
    },
    end(body = "") {
      this.body = body;
      return this;
    }
  };
}

function request(method, authorization = `Bearer ${TOKEN}`) {
  return {
    method,
    headers: {
      authorization,
      "x-tiendaiq-load-test": "synthetic",
      "x-load-test-run-id": "run-1",
      "x-load-test-session-id": "session-1",
      "idempotency-key": "load:run-1:request-1"
    }
  };
}

test("los endpoints quedan ausentes cuando la compuerta esta apagada", async () => {
  const handler = createSyntheticLoadHandler({ enabled: "0", environment: "", token: "", readJson: async () => ({}) });
  const res = responseRecorder();
  assert.equal(await handler(request("GET"), res, new URL("http://local/__load/session")), false);
  assert.equal(res.status, null);
});

test("la configuracion falla cerrada fuera de staging o con token debil", () => {
  assert.throws(
    () => createHandler({ environment: "production" }),
    /solo pueden habilitarse/
  );
  assert.throws(
    () => createHandler({ token: "corto" }),
    /al menos 32/
  );
  assert.throws(
    () => createHandler({ expiresAt: "2026-08-11T15:00:00.000Z" }),
    /proximas 2 horas/
  );
});

test("rechaza credenciales incorrectas sin filtrar el token esperado", async () => {
  const handler = createHandler();
  const res = responseRecorder();
  assert.equal(await handler(request("GET", "Bearer incorrecto"), res, new URL("http://local/__load/session")), true);
  assert.equal(res.status, 401);
  assert.deepEqual(JSON.parse(res.body), { error: "unauthorized" });
  assert.doesNotMatch(res.body, new RegExp(TOKEN));
});

test("acepta sesiones y jobs estrictamente sinteticos", async () => {
  const handler = createHandler({
    readJson: async () => ({ type: "synthetic-load-job", simulated: true, request_id: "request-1" })
  });

  const sessionRes = responseRecorder();
  await handler(request("GET"), sessionRes, new URL("http://local/__load/session"));
  assert.equal(sessionRes.status, 200);
  assert.equal(JSON.parse(sessionRes.body).synthetic, true);
  assert.equal(sessionRes.headers["Cache-Control"], "no-store");

  const jobRes = responseRecorder();
  await handler(request("POST"), jobRes, new URL("http://local/__load/jobs"));
  assert.equal(jobRes.status, 202);
  assert.deepEqual(JSON.parse(jobRes.body), {
    accepted: true,
    synthetic: true,
    run_id: "run-1",
    request_id: "request-1"
  });
});

test("rechaza payloads que podrian confundirse con trabajo real", async () => {
  const handler = createHandler({
    readJson: async () => ({ type: "generate-page", simulated: false, request_id: "request-1" })
  });
  const res = responseRecorder();
  await handler(request("POST"), res, new URL("http://local/__load/jobs"));
  assert.equal(res.status, 422);
  assert.deepEqual(JSON.parse(res.body), { error: "invalid_synthetic_job" });
});

test("la ventana expirada se cierra aunque las variables sigan presentes", async () => {
  let currentTime = NOW;
  const handler = createHandler({ now: () => currentTime });
  currentTime = Date.parse(EXPIRES_AT);
  const res = responseRecorder();
  await handler(request("GET"), res, new URL("http://local/__load/session"));
  assert.equal(res.status, 404);
  assert.deepEqual(JSON.parse(res.body), { error: "not_found" });
});
