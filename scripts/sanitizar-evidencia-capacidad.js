"use strict";

const fs = require("fs");

const RESULT_FIELDS = Object.freeze([
  "passed", "mode", "runId", "tenants", "jobs", "workerLanes", "fakeWorkMs",
  "setupMs", "enqueueMs", "enqueueP95Ms", "oldestQueuedSeconds", "drainMs",
  "jobsPerSecond", "maxDrainSeconds", "webPoolPeak", "workerPoolPeak", "cleanup"
]);
const CLEANUP_FIELDS = Object.freeze([
  "jobsDeleted",
  "storesDeleted",
  "tenantsDeleted",
  "failedJobDeletion",
  "failedTenantDeletions",
  "jobFailureClass",
  "tenantFailureClass"
]);
const CLEANUP_FAILURE_CLASSES = /^(?:authorization|referential_integrity|schema|connection|unclassified|mixed)$/;
const FAILURE_CLASSES = Object.freeze([
  "authorization_configuration",
  "database_connection",
  "database_authorization",
  "database_schema",
  "queue_integrity",
  "cleanup",
  "unclassified"
]);
const LOAD_PHASES = Object.freeze([
  "authorization",
  "tenant_setup",
  "enqueue",
  "drain",
  "verification",
  "cleanup"
]);

function releaseSha(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(normalized)) throw new Error("releaseSha debe ser un SHA completo de 40 caracteres");
  return normalized;
}

function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function string(value, pattern) {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function sanitizeCleanup(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const safe = {};
  for (const field of CLEANUP_FIELDS) {
    if (field === "failedJobDeletion") {
      if (typeof value.failedJobDeletion === "boolean") safe.failedJobDeletion = value.failedJobDeletion;
      continue;
    }
    if (field === "jobFailureClass" || field === "tenantFailureClass") {
      const classification = string(value[field], CLEANUP_FAILURE_CLASSES);
      if (classification) safe[field] = classification;
      continue;
    }
    const valueForField = number(value[field]);
    if (valueForField !== undefined) safe[field] = valueForField;
  }
  return Object.keys(safe).length ? safe : undefined;
}

function sanitizeResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const safe = {};
  for (const field of RESULT_FIELDS) {
    if (field === "passed") {
      if (typeof value.passed === "boolean") safe.passed = value.passed;
      continue;
    }
    if (field === "mode") {
      const mode = string(value.mode, /^(?:run|cleanup)$/);
      if (mode) safe.mode = mode;
      continue;
    }
    if (field === "runId") {
      const runId = string(value.runId, /^[a-f0-9]{12}$/i);
      if (runId) safe.runId = runId.toLowerCase();
      continue;
    }
    if (field === "cleanup") {
      const cleanup = sanitizeCleanup(value.cleanup);
      if (cleanup) safe.cleanup = cleanup;
      continue;
    }
    const valueForField = number(value[field]);
    if (valueForField !== undefined) safe[field] = valueForField;
  }
  return Object.keys(safe).length ? safe : undefined;
}

function parsedJsonLines(log) {
  const lines = String(log || "").split(/\r?\n/);
  const parsed = [];
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object" && !Array.isArray(value)) parsed.push(value);
    } catch {}
  }
  return parsed;
}

function lastJsonObject(log) {
  return parsedJsonLines(log).at(-1);
}

function lastResultObject(log) {
  const values = parsedJsonLines(log);
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (typeof value.passed === "boolean" || value.event === "queue_load_started") return value;
  }
  return undefined;
}

function lastFailureCleanup(log) {
  const values = parsedJsonLines(log);
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value.event !== "queue_load_failure" && value.event !== "queue_load_cleanup_result") continue;
    const cleanup = sanitizeCleanup(value.cleanup);
    if (cleanup) return cleanup;
  }
  return undefined;
}

function classifyFailure(log) {
  const normalized = String(log || "").toLowerCase();
  if (/allow_queue_load_test|allow_remote_queue_load_test|expected_release_sha|test_database_url|load_cleanup_run_id/.test(normalized)) {
    return "authorization_configuration";
  }
  if (/permission denied|row-level security|not authorized|must be member|insufficient privilege/.test(normalized)) {
    return "database_authorization";
  }
  if (/relation .* does not exist|column .* does not exist|schema .* does not exist|undefined table/.test(normalized)) {
    return "database_schema";
  }
  if (/cleanup|persisten .* jobs|limpieza incompleta|limpieza no verificable/.test(normalized)) {
    return "cleanup";
  }
  if (/lease perdido|se procesaron|estado final invalido|cola persistio/.test(normalized)) {
    return "queue_integrity";
  }
  if (/econn|connect|connection|timeout|certificate|tls|ssl|authentication failed|enotfound/.test(normalized)) {
    return "database_connection";
  }
  return "unclassified";
}

function lastPhase(log) {
  const values = parsedJsonLines(log);
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const phase = string(values[index].phase, /^(?:authorization|tenant_setup|enqueue|drain|verification|cleanup)$/);
    if (phase) return phase;
  }
  return "unknown";
}

function createArtifact({ log, release, mode, exitCode }) {
  const safeMode = String(mode || "").trim();
  if (!["run", "cleanup"].includes(safeMode)) throw new Error("mode invalido");
  const numericExitCode = Number(exitCode);
  if (!Number.isInteger(numericExitCode) || numericExitCode < 0 || numericExitCode > 255) throw new Error("exitCode invalido");
  const result = sanitizeResult(lastResultObject(log));
  const failureCleanup = lastFailureCleanup(log);
  const failureClass = numericExitCode === 0 ? undefined : classifyFailure(log);
  return {
    schema_version: 1,
    scope: "partner-staging-synthetic-queue",
    release_sha: releaseSha(release),
    mode: safeMode,
    completed: numericExitCode === 0,
    result_detected: Boolean(result),
    ...(result ? { result } : {}),
    ...(failureCleanup ? { cleanup: failureCleanup } : {}),
    ...(failureClass ? { failure: { class: failureClass, phase: lastPhase(log) } } : {})
  };
}

function main(argv = process.argv.slice(2)) {
  const [inputPath, outputPath, release, mode, exitCode] = argv;
  if (!inputPath || !outputPath) throw new Error("uso: node scripts/sanitizar-evidencia-capacidad.js <log> <output> <sha> <mode> <exitCode>");
  const artifact = createArtifact({ log: fs.readFileSync(inputPath, "utf8"), release, mode, exitCode });
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact)}\n`, "utf8");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`No se pudo crear evidencia sanitizada: ${error.message}`);
    process.exitCode = 2;
  }
}

module.exports = { createArtifact, lastJsonObject, sanitizeResult, classifyFailure, lastPhase, FAILURE_CLASSES, LOAD_PHASES };
