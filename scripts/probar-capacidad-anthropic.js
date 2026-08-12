"use strict";

const { performance } = require("perf_hooks");

const AUTHORIZATION = "I_AUTHORIZE_PAID_ANTHROPIC_STAGING_CAPACITY";
const MAX_CALLS = 500;
const MAX_CONCURRENCY = 8;

function numeric(value, name, { min, max, integer = false }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${name} debe estar entre ${min} y ${max}${integer ? " y ser entero" : ""}`);
  }
  return parsed;
}

function configuration(env = process.env) {
  if (env.AI_CAPACITY_ENVIRONMENT !== "staging") {
    throw new Error("AI_CAPACITY_ENVIRONMENT debe ser staging");
  }
  if (env.ALLOW_PAID_ANTHROPIC_CAPACITY !== AUTHORIZATION) {
    throw new Error(`Falta la autorizacion exacta ${AUTHORIZATION}`);
  }
  if (!String(env.ANTHROPIC_API_KEY || "").trim()) {
    throw new Error("Falta ANTHROPIC_API_KEY");
  }

  return Object.freeze({
    calls: numeric(env.AI_CAPACITY_CALLS, "AI_CAPACITY_CALLS", { min: 1, max: MAX_CALLS, integer: true }),
    concurrency: numeric(env.AI_CAPACITY_CONCURRENCY, "AI_CAPACITY_CONCURRENCY", {
      min: 1,
      max: MAX_CONCURRENCY,
      integer: true
    }),
    maxBudgetUsd: numeric(env.AI_CAPACITY_MAX_BUDGET_USD, "AI_CAPACITY_MAX_BUDGET_USD", { min: 0.01, max: 1000 }),
    inputPricePerMtok: numeric(env.AI_INPUT_PRICE_USD_PER_MTOK, "AI_INPUT_PRICE_USD_PER_MTOK", {
      min: 0.01,
      max: 1000
    }),
    outputPricePerMtok: numeric(env.AI_OUTPUT_PRICE_USD_PER_MTOK, "AI_OUTPUT_PRICE_USD_PER_MTOK", {
      min: 0.01,
      max: 5000
    }),
    maxP95Ms: numeric(env.AI_CAPACITY_MAX_P95_MS || 120000, "AI_CAPACITY_MAX_P95_MS", {
      min: 1000,
      max: 600000,
      integer: true
    }),
    maxErrorRate: numeric(env.AI_CAPACITY_MAX_ERROR_RATE || 0.01, "AI_CAPACITY_MAX_ERROR_RATE", { min: 0, max: 1 })
  });
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function tokenUsage(usage = {}) {
  return {
    input: Number(usage.input_tokens || 0) +
      Number(usage.cache_creation_input_tokens || 0) +
      Number(usage.cache_read_input_tokens || 0),
    output: Number(usage.output_tokens || 0)
  };
}

function usageCostUsd(usage, config) {
  const tokens = tokenUsage(usage);
  return ((tokens.input * config.inputPricePerMtok) + (tokens.output * config.outputPricePerMtok)) / 1_000_000;
}

function classifyError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  if (status === 429) return "rate_limit";
  if (status === 529) return "overloaded";
  if (status === 401 || status === 403) return "authentication";
  if (error?.name === "AbortError" || error?.code === "ETIMEDOUT") return "timeout";
  return status ? `http_${status}` : "provider_error";
}

function sanitizeErrorSample(error) {
  const text = String(
    error?.message ||
    error?.error?.message ||
    error?.response?.data?.error?.message ||
    error?.body?.error?.message ||
    error?.body ||
    error
  );
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted_anthropic_key]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

async function parallelMap(count, concurrency, work) {
  let cursor = 0;
  const results = new Array(count);
  const lanes = Array.from({ length: Math.min(count, concurrency) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= count) return;
      results[index] = await work(index);
    }
  });
  await Promise.all(lanes);
  return results;
}

async function measuredCall(generate) {
  const started = performance.now();
  try {
    const result = await generate();
    return {
      ok: true,
      latencyMs: performance.now() - started,
      usage: result.usage || {},
      warnings: Number(result.warnings || 0)
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: performance.now() - started,
      errorType: classifyError(error),
      errorSample: sanitizeErrorSample(error),
      usage: {}
    };
  }
}

function summarize(records, config) {
  const successful = records.filter((record) => record.ok);
  const failures = records.filter((record) => !record.ok);
  const inputTokens = successful.reduce((total, record) => total + tokenUsage(record.usage).input, 0);
  const outputTokens = successful.reduce((total, record) => total + tokenUsage(record.usage).output, 0);
  const costUsd = successful.reduce((total, record) => total + usageCostUsd(record.usage, config), 0);
  const errorTypes = {};
  for (const failure of failures) errorTypes[failure.errorType] = (errorTypes[failure.errorType] || 0) + 1;
  const errorSamples = {};
  for (const failure of failures) {
    if (!failure.errorSample) continue;
    const samples = errorSamples[failure.errorType] || [];
    if (samples.length < 3 && !samples.includes(failure.errorSample)) samples.push(failure.errorSample);
    errorSamples[failure.errorType] = samples;
  }
  const errorRate = records.length ? failures.length / records.length : 1;
  const latencies = records.map((record) => record.latencyMs);
  const p95Ms = percentile(latencies, 0.95);
  const violations = [];
  if (errorRate > config.maxErrorRate) violations.push(`error_rate=${errorRate} > ${config.maxErrorRate}`);
  if (p95Ms > config.maxP95Ms) violations.push(`p95_ms=${p95Ms} > ${config.maxP95Ms}`);
  if (costUsd > config.maxBudgetUsd) violations.push(`cost_usd=${costUsd} > ${config.maxBudgetUsd}`);

  return {
    passed: violations.length === 0,
    calls: records.length,
    succeeded: successful.length,
    failed: failures.length,
    errorRate,
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: p95Ms,
      p99: percentile(latencies, 0.99),
      max: latencies.length ? Math.max(...latencies) : 0
    },
    tokens: { input: inputTokens, output: outputTokens },
    warnings: successful.reduce((total, record) => total + record.warnings, 0),
    estimatedCostUsd: costUsd,
    errorTypes,
    errorSamples,
    violations
  };
}

async function runCapacityProbe(config, generate) {
  const pilot = await measuredCall(generate);
  if (!pilot.ok) return summarize([pilot], config);

  const pilotCost = usageCostUsd(pilot.usage, config);
  const projectedCost = pilotCost * config.calls * 1.25;
  if (projectedCost > config.maxBudgetUsd) {
    const error = new Error(
      `Proyeccion conservadora USD ${projectedCost.toFixed(4)} supera el techo USD ${config.maxBudgetUsd.toFixed(2)}`
    );
    error.code = "BUDGET_GUARD";
    error.pilot = pilot;
    error.projectedCostUsd = projectedCost;
    throw error;
  }

  const remaining = await parallelMap(config.calls - 1, config.concurrency, () => measuredCall(generate));
  return summarize([pilot, ...remaining], config);
}

function syntheticProduct() {
  return Object.freeze({
    titulo_crudo: "Botella termica de acero inoxidable",
    descripcion_cruda: "Botella reutilizable de 750 ml con tapa hermetica y aislamiento de doble pared.",
    precio: "39.90",
    precio_comparativo: "49.90",
    moneda: "USD"
  });
}

function round(value) {
  return Number(Number(value).toFixed(4));
}

function printable(result, config, durationMs) {
  return {
    ...result,
    errorRate: round(result.errorRate),
    latencyMs: Object.fromEntries(Object.entries(result.latencyMs).map(([key, value]) => [key, round(value)])),
    estimatedCostUsd: round(result.estimatedCostUsd),
    durationMs: round(durationMs),
    configuration: {
      calls: config.calls,
      concurrency: config.concurrency,
      maxBudgetUsd: config.maxBudgetUsd,
      maxErrorRate: config.maxErrorRate,
      maxP95Ms: config.maxP95Ms,
      model: process.env.MODELO_IA || "claude-sonnet-5"
    }
  };
}

async function main() {
  const config = configuration();
  const { generar, ensamblar, validar } = require("../adaptador");
  const fuente = syntheticProduct();
  const started = performance.now();
  const result = await runCapacityProbe(config, async () => {
    const generated = await generar(fuente, [], { idioma: "es", angulo: "uso cotidiano" });
    const data = ensamblar(fuente, generated.salida, { idioma: "es", angulo: "uso cotidiano" });
    const warnings = validar(data, generated.salida).length;
    return { usage: generated.uso, warnings };
  });
  const output = printable(result, config, performance.now() - started);
  console.log(JSON.stringify(output));
  if (!result.passed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    const safe = {
      ok: false,
      code: error.code || "CAPACITY_PROBE_FAILED",
      message: String(error.message || error).slice(0, 300),
      projectedCostUsd: error.projectedCostUsd == null ? undefined : round(error.projectedCostUsd)
    };
    console.error(JSON.stringify(safe));
    process.exitCode = 1;
  });
}

module.exports = {
  AUTHORIZATION,
  MAX_CALLS,
  MAX_CONCURRENCY,
  classifyError,
  configuration,
  measuredCall,
  parallelMap,
  percentile,
  runCapacityProbe,
  sanitizeErrorSample,
  summarize,
  tokenUsage,
  usageCostUsd
};
