"use strict";

const fs = require("fs");

const RESULT_FIELDS = Object.freeze([
  "passed", "mode", "runId", "tenants", "jobs", "workerLanes", "fakeWorkMs",
  "setupMs", "enqueueMs", "enqueueP95Ms", "oldestQueuedSeconds", "drainMs",
  "jobsPerSecond", "maxDrainSeconds", "webPoolPeak", "workerPoolPeak", "cleanup"
]);
const CLEANUP_FIELDS = Object.freeze(["jobsDeleted", "storesDeleted", "tenantsDeleted"]);

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

function lastJsonObject(log) {
  const lines = String(log || "").split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return undefined;
}

function createArtifact({ log, release, mode, exitCode }) {
  const safeMode = String(mode || "").trim();
  if (!["run", "cleanup"].includes(safeMode)) throw new Error("mode invalido");
  const numericExitCode = Number(exitCode);
  if (!Number.isInteger(numericExitCode) || numericExitCode < 0 || numericExitCode > 255) throw new Error("exitCode invalido");
  const result = sanitizeResult(lastJsonObject(log));
  return {
    schema_version: 1,
    scope: "partner-staging-synthetic-queue",
    release_sha: releaseSha(release),
    mode: safeMode,
    completed: numericExitCode === 0,
    result_detected: Boolean(result),
    ...(result ? { result } : {})
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

module.exports = { createArtifact, lastJsonObject, sanitizeResult };
