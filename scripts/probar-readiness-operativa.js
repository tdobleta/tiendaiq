"use strict";

const { URL } = require("node:url");

const CONFIRMATION = "CHECK_STAGING_OPS_READINESS";
const DEFAULT_STAGING_URL = "https://tiendaiq-staging-web.onrender.com";

function integer(value, fallback, min, max, name) {
  const parsed = value == null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} debe ser un entero entre ${min} y ${max}`);
  }
  return parsed;
}

function normalizeAppUrl(value = DEFAULT_STAGING_URL) {
  const url = new URL(String(value || "").trim());
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("STAGING_APP_URL debe ser http o https");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function assertExpectedSha(value) {
  const sha = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error("EXPECTED_RELEASE_SHA debe ser un SHA completo de 40 caracteres");
  }
  return sha;
}

function summarizeQueue(rows) {
  const totals = {
    types: 0,
    queued: 0,
    running: 0,
    failed: 0,
    oldestQueuedSeconds: 0
  };
  for (const row of rows || []) {
    totals.types += 1;
    totals.queued += Number(row.queued || 0);
    totals.running += Number(row.running || 0);
    totals.failed += Number(row.failed || 0);
    totals.oldestQueuedSeconds = Math.max(
      totals.oldestQueuedSeconds,
      Number(row.oldestQueuedSeconds || 0)
    );
  }
  return totals;
}

function evaluateReady(payload, expectedSha) {
  const errors = [];
  const aislamiento = payload?.aislamiento || {};
  const release = String(payload?.release || "").toLowerCase();

  if (!payload?.ok) errors.push("/ready no respondio ok=true");
  if (payload?.almacenamiento !== "postgres") errors.push("/ready no esta usando PostgreSQL");
  if (release !== expectedSha) errors.push(`/ready release ${release || "(vacio)"} no coincide con ${expectedSha}`);
  if (aislamiento.enabled !== true) errors.push("RLS no figura habilitado en /ready");
  if (aislamiento.forced !== true) errors.push("RLS no figura forzado en /ready");
  if (Number(aislamiento.protectedTables || 0) < 1) errors.push("/ready no reporta tablas protegidas");
  if (aislamiento.roleBypassesRls !== false) errors.push("el rol web puede omitir RLS");
  if (aislamiento.inheritsRoles !== false) errors.push("el rol web hereda privilegios");
  if (aislamiento.workerCapability !== false) errors.push("el rol web tiene capacidad worker");

  return { ok: errors.length === 0, errors };
}

function evaluateQueue(summary, { maxOldestQueuedSeconds, maxRunning, maxFailed }) {
  const errors = [];
  if (summary.oldestQueuedSeconds > maxOldestQueuedSeconds) {
    errors.push(`cola vieja: ${summary.oldestQueuedSeconds.toFixed(2)}s > ${maxOldestQueuedSeconds}s`);
  }
  if (summary.running > maxRunning) {
    errors.push(`jobs running fuera de umbral: ${summary.running} > ${maxRunning}`);
  }
  if (summary.failed > maxFailed) {
    errors.push(`jobs failed fuera de umbral: ${summary.failed} > ${maxFailed}`);
  }
  return { ok: errors.length === 0, errors };
}

async function fetchReady(appUrl, expectedSha, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${appUrl}/ready`, { signal: controller.signal });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`/ready no devolvio JSON valido: ${text.slice(0, 120)}`);
    }
    if (!response.ok) {
      throw new Error(`/ready respondio HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const evaluation = evaluateReady(payload, expectedSha);
    return { payload, evaluation };
  } finally {
    clearTimeout(timeout);
  }
}

async function readQueueSummary(databaseUrl) {
  if (!databaseUrl) throw new Error("OPERATIONS_DATABASE_URL o TEST_WORKER_DATABASE_URL es obligatorio");

  process.env.DATABASE_URL = databaseUrl;
  process.env.PG_RUNTIME_ROLE = process.env.PG_RUNTIME_ROLE || "tiendaiq_worker_runtime";
  const { estadoColaDB, cerrarAlmacenamientoDB } = require("../db");
  try {
    const rows = await estadoColaDB("ops-readiness");
    return { rows, summary: summarizeQueue(rows) };
  } finally {
    await cerrarAlmacenamientoDB();
  }
}

async function main() {
  if (process.env.CONFIRMATION !== CONFIRMATION) {
    throw new Error(`CONFIRMATION debe ser ${CONFIRMATION}`);
  }

  const expectedSha = assertExpectedSha(process.env.EXPECTED_RELEASE_SHA);
  const appUrl = normalizeAppUrl(process.env.STAGING_APP_URL || DEFAULT_STAGING_URL);
  const maxOldestQueuedSeconds = integer(process.env.OPS_MAX_OLDEST_JOB_SECONDS, 600, 1, 86400, "OPS_MAX_OLDEST_JOB_SECONDS");
  const maxRunning = integer(process.env.OPS_MAX_RUNNING_JOBS, 500, 0, 100000, "OPS_MAX_RUNNING_JOBS");
  const maxFailed = integer(process.env.OPS_MAX_FAILED_JOBS, 1000, 0, 100000, "OPS_MAX_FAILED_JOBS");
  const databaseUrl = process.env.OPERATIONS_DATABASE_URL || process.env.TEST_WORKER_DATABASE_URL;

  const ready = await fetchReady(appUrl, expectedSha);
  const queue = await readQueueSummary(databaseUrl);
  const queueEvaluation = evaluateQueue(queue.summary, { maxOldestQueuedSeconds, maxRunning, maxFailed });
  const errors = [...ready.evaluation.errors, ...queueEvaluation.errors];
  const result = {
    event: "ops_readiness_staging",
    ok: errors.length === 0,
    appUrl,
    expectedRelease: expectedSha,
    ready: ready.payload,
    queue: queue.summary,
    thresholds: { maxOldestQueuedSeconds, maxRunning, maxFailed },
    errors
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length) {
    throw new Error(`readiness operativa fallo: ${errors.join("; ")}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  CONFIRMATION,
  assertExpectedSha,
  evaluateQueue,
  evaluateReady,
  integer,
  normalizeAppUrl,
  summarizeQueue
};
