"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AUTHORIZATION,
  classifyError,
  configuration,
  runCapacityProbe,
  sanitizeErrorSample,
  summarize,
  tokenUsage,
  usageCostUsd
} = require("../scripts/probar-capacidad-anthropic");

function env(overrides = {}) {
  return {
    AI_CAPACITY_ENVIRONMENT: "staging",
    ALLOW_PAID_ANTHROPIC_CAPACITY: AUTHORIZATION,
    ANTHROPIC_API_KEY: "test-key",
    AI_CAPACITY_CALLS: "8",
    AI_CAPACITY_CONCURRENCY: "8",
    AI_CAPACITY_MAX_BUDGET_USD: "5",
    AI_INPUT_PRICE_USD_PER_MTOK: "5",
    AI_OUTPUT_PRICE_USD_PER_MTOK: "25",
    ...overrides
  };
}

test("bloquea cualquier entorno que no sea staging", () => {
  assert.throws(() => configuration(env({ AI_CAPACITY_ENVIRONMENT: "production" })), /debe ser staging/);
});

test("exige autorizacion paga exacta y API key", () => {
  assert.throws(() => configuration(env({ ALLOW_PAID_ANTHROPIC_CAPACITY: "yes" })), /autorizacion exacta/);
  assert.throws(() => configuration(env({ ANTHROPIC_API_KEY: "" })), /ANTHROPIC_API_KEY/);
});

test("limita llamadas y concurrencia", () => {
  assert.throws(() => configuration(env({ AI_CAPACITY_CALLS: "501" })), /AI_CAPACITY_CALLS/);
  assert.throws(() => configuration(env({ AI_CAPACITY_CONCURRENCY: "9" })), /AI_CAPACITY_CONCURRENCY/);
});

test("calcula tokens y costo de forma conservadora", () => {
  const usage = {
    input_tokens: 1000,
    output_tokens: 2000,
    cache_creation_input_tokens: 300,
    cache_read_input_tokens: 200
  };
  assert.deepEqual(tokenUsage(usage), { input: 1500, output: 2000 });
  assert.equal(usageCostUsd(usage, configuration(env())), 0.0575);
});

test("la muestra inicial detiene el resto si proyecta superar presupuesto", async () => {
  const config = configuration(env({ AI_CAPACITY_MAX_BUDGET_USD: "0.01" }));
  let calls = 0;
  await assert.rejects(
    runCapacityProbe(config, async () => {
      calls += 1;
      return { usage: { input_tokens: 1000, output_tokens: 1000 } };
    }),
    (error) => error.code === "BUDGET_GUARD"
  );
  assert.equal(calls, 1);
});

test("ejecuta el perfil completo dentro del presupuesto", async () => {
  const config = configuration(env());
  let calls = 0;
  const result = await runCapacityProbe(config, async () => {
    calls += 1;
    return { usage: { input_tokens: 100, output_tokens: 100 }, warnings: 1 };
  });
  assert.equal(calls, 8);
  assert.equal(result.passed, true);
  assert.equal(result.succeeded, 8);
  assert.equal(result.warnings, 8);
});

test("clasifica rate limit y resume errores contra los umbrales", () => {
  assert.equal(classifyError({ status: 429 }), "rate_limit");
  const config = configuration(env());
  const result = summarize([
    { ok: true, latencyMs: 10, usage: { input_tokens: 1, output_tokens: 1 }, warnings: 0 },
    { ok: false, latencyMs: 20, usage: {}, errorType: "rate_limit", errorSample: "429 Too Many Requests" }
  ], config);
  assert.equal(result.passed, false);
  assert.equal(result.errorTypes.rate_limit, 1);
  assert.deepEqual(result.errorSamples.rate_limit, ["429 Too Many Requests"]);
});

test("sanitiza muestras de error sin exponer credenciales", () => {
  const sample = sanitizeErrorSample(new Error("fallo con Bearer secret-token y sk-ant-api03-real"));
  assert.equal(sample.includes("secret-token"), false);
  assert.equal(sample.includes("sk-ant-api03-real"), false);
  assert.match(sample, /Bearer \[redacted\]/);
  assert.match(sample, /\[redacted_anthropic_key\]/);
});
