"use strict";

const { URL } = require("node:url");

const CONFIRMATION = "CHECK_STAGING_OPS_READINESS";
const PRODUCTION_CONFIRMATION = "CHECK_PRODUCTION_OPS_READINESS";
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
    throw new Error("OPS_APP_URL debe ser http o https");
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

function assertOpsStatusToken(value) {
  const token = String(value || "").trim();
  if (token.length < 32) {
    throw new Error("OPS_STATUS_TOKEN debe tener al menos 32 caracteres");
  }
  return token;
}

function booleanFlag(value) {
  return ["1", "true", "yes", "si", "y"].includes(String(value || "").trim().toLowerCase());
}

function readinessProfile(value) {
  const profile = String(value || "technical_preflight").trim().toLowerCase();
  if (!["technical_preflight", "go", "rollback"].includes(profile)) {
    throw new Error("OPS_READINESS_PROFILE debe ser technical_preflight, go o rollback");
  }
  return profile;
}

function summarizeQueue(rows) {
  const totals = {
    types: 0,
    queued: 0,
    running: 0,
    failed: 0,
    failedRecent: 0,
    staleRunning: 0,
    compensationPending: 0,
    compensationDeadLetter: 0,
    staleCompensation: 0,
    oldestQueuedSeconds: 0,
    oldestCompensationSeconds: 0
  };
  for (const row of rows || []) {
    totals.types += 1;
    totals.queued += Number(row.queued || 0);
    totals.running += Number(row.running || 0);
    totals.failed += Number(row.failed || 0);
    totals.failedRecent += Number(row.failedRecent || 0);
    totals.staleRunning += Number(row.staleRunning || 0);
    totals.compensationPending += Number(row.compensationPending || 0);
    totals.compensationDeadLetter += Number(row.compensationDeadLetter || 0);
    totals.staleCompensation += Number(row.staleCompensation || 0);
    totals.oldestQueuedSeconds = Math.max(
      totals.oldestQueuedSeconds,
      Number(row.oldestQueuedSeconds || 0)
    );
    totals.oldestCompensationSeconds = Math.max(
      totals.oldestCompensationSeconds,
      Number(row.oldestCompensationSeconds || 0)
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

function evaluateQueue(summary, {
  maxQueued,
  maxOldestQueuedSeconds,
  maxRunning,
  maxFailedRecent,
  maxStaleRunning,
  maxCompensationPending,
  maxCompensationDeadLetter,
  maxStaleCompensation,
  maxOldestCompensationSeconds
}) {
  const errors = [];
  if (summary.queued > maxQueued) {
    errors.push(`jobs queued fuera de umbral: ${summary.queued} > ${maxQueued}`);
  }
  if (summary.oldestQueuedSeconds > maxOldestQueuedSeconds) {
    errors.push(`cola vieja: ${summary.oldestQueuedSeconds.toFixed(2)}s > ${maxOldestQueuedSeconds}s`);
  }
  if (summary.running > maxRunning) {
    errors.push(`jobs running fuera de umbral: ${summary.running} > ${maxRunning}`);
  }
  if (summary.failedRecent > maxFailedRecent) {
    errors.push(`jobs fallidos recientes: ${summary.failedRecent} > ${maxFailedRecent}`);
  }
  if (summary.staleRunning > maxStaleRunning) {
    errors.push(`leases estancados: ${summary.staleRunning} > ${maxStaleRunning}`);
  }
  if (summary.compensationPending > maxCompensationPending) {
    errors.push(`compensaciones pendientes: ${summary.compensationPending} > ${maxCompensationPending}`);
  }
  if (summary.compensationDeadLetter > maxCompensationDeadLetter) {
    errors.push(`compensaciones en cuarentena: ${summary.compensationDeadLetter} > ${maxCompensationDeadLetter}`);
  }
  if (summary.staleCompensation > maxStaleCompensation) {
    errors.push(`leases de compensacion estancados: ${summary.staleCompensation} > ${maxStaleCompensation}`);
  }
  if (summary.oldestCompensationSeconds > maxOldestCompensationSeconds) {
    errors.push(`compensacion vieja: ${summary.oldestCompensationSeconds.toFixed(2)}s > ${maxOldestCompensationSeconds}s`);
  }
  return { ok: errors.length === 0, errors };
}

function evaluateInbox(inbox, {
  maxInboxReceived,
  maxInboxProcessing,
  maxInboxFailed,
  maxInboxFailedRecent,
  maxInboxStaleProcessing,
  maxOldestInboxSeconds
}) {
  const errors = [];
  if (inbox.received > maxInboxReceived) {
    errors.push(`webhooks recibidos fuera de umbral: ${inbox.received} > ${maxInboxReceived}`);
  }
  if (inbox.processing > maxInboxProcessing) {
    errors.push(`webhooks procesando fuera de umbral: ${inbox.processing} > ${maxInboxProcessing}`);
  }
  if (inbox.failed > maxInboxFailed) {
    errors.push(`webhooks en cuarentena: ${inbox.failed} > ${maxInboxFailed}`);
  }
  if (inbox.failedRecent > maxInboxFailedRecent) {
    errors.push(`webhooks fallidos recientes: ${inbox.failedRecent} > ${maxInboxFailedRecent}`);
  }
  if (inbox.staleProcessing > maxInboxStaleProcessing) {
    errors.push(`leases de webhooks estancadas: ${inbox.staleProcessing} > ${maxInboxStaleProcessing}`);
  }
  if (inbox.oldestReceivedSeconds > maxOldestInboxSeconds) {
    errors.push(`bandeja de webhooks vieja: ${inbox.oldestReceivedSeconds.toFixed(2)}s > ${maxOldestInboxSeconds}s`);
  }
  return { ok: errors.length === 0, errors };
}

function evaluateOpsStatus(payload, expectedSha, thresholds, requirements = {}) {
  const errors = [];
  const release = String(payload?.release || "").toLowerCase();
  const admission = payload?.generationAdmission || {};
  const totals = payload?.totals || {};
  const billing = payload?.billing || {};
  const legal = payload?.legal || {};
  const worker = payload?.worker;
  const inbox = payload?.inbox || {};

  if (!payload?.ok) errors.push("/ops/status no respondio ok=true");
  if (release !== expectedSha) errors.push(`/ops/status release ${release || "(vacio)"} no coincide con ${expectedSha}`);
  if (typeof billing.planTest !== "boolean") errors.push("/ops/status no devuelve billing.planTest boolean");
  if (requirements.requireRealBilling && billing.planTest === true) {
    errors.push("/ops/status reporta billing en modo test");
  }
  if (typeof legal.complete !== "boolean") errors.push("/ops/status no devuelve legal.complete boolean");
  if (!Array.isArray(legal.missing)) errors.push("/ops/status no devuelve legal.missing[]");
  if (requirements.requireLegalComplete && legal.complete !== true) {
    errors.push(`/ops/status reporta legales incompletas: ${(legal.missing || []).join(", ") || "desconocido"}`);
  }
  if (!Array.isArray(payload?.queue)) errors.push("/ops/status no devuelve queue[]");
  if (typeof admission.paused !== "boolean") errors.push("/ops/status no devuelve generationAdmission.paused boolean");
  if (requirements.requireAdmissionOpen && admission.paused === true) {
    errors.push("/ops/status reporta admision de generaciones pausada");
  }
  if (!Number.isFinite(Number(admission.retryAfter))) errors.push("/ops/status no devuelve generationAdmission.retryAfter numerico");
  if (!worker || typeof worker !== "object") {
    errors.push("/ops/status no reporta heartbeat del worker");
  } else {
    if (String(worker.release || "").toLowerCase() !== expectedSha) errors.push("el worker no ejecuta el SHA esperado");
    if (worker.runtimeRole !== "tiendaiq_worker_runtime") errors.push("el worker no usa el rol runtime aislado");
    if (worker.isolationOk !== true) errors.push("el worker no confirma aislamiento RLS");
    if (!Number.isInteger(Number(worker.activeWorkers)) || Number(worker.activeWorkers) < 1) {
      errors.push("no hay workers activos confirmados");
    }
    if (Number(worker.releaseVariants) !== 1) errors.push("los workers activos no comparten un unico SHA");
    if (Number(worker.runtimeRoleVariants) !== 1) errors.push("los workers activos no comparten un unico rol runtime");
    if (!Number.isFinite(Number(worker.ageSeconds)) || Number(worker.ageSeconds) > thresholds.maxWorkerAgeSeconds) {
      errors.push(`heartbeat del worker vencido: ${worker?.ageSeconds ?? "ausente"}s`);
    }
    if (!Number.isFinite(Number(worker.uptimeSeconds)) || Number(worker.uptimeSeconds) < thresholds.minWorkerUptimeSeconds) {
      errors.push(`worker sin estabilidad minima: ${worker?.uptimeSeconds ?? "ausente"}s`);
    }
    const capacity = {
      generations: Number(worker.generationConcurrency),
      publications: Number(worker.publicationConcurrency),
      webhooks: Number(worker.webhookConcurrency)
    };
    if (!Number.isInteger(capacity.generations) || capacity.generations < thresholds.minGenerationConcurrency) {
      errors.push(`capacidad de generacion insuficiente: ${worker.generationConcurrency ?? "ausente"}`);
    }
    if (!Number.isInteger(capacity.publications) || capacity.publications < thresholds.minPublicationConcurrency) {
      errors.push(`capacidad de publicacion insuficiente: ${worker.publicationConcurrency ?? "ausente"}`);
    }
    if (!Number.isInteger(capacity.webhooks) || capacity.webhooks < thresholds.minWebhookConcurrency) {
      errors.push(`capacidad de webhooks insuficiente: ${worker.webhookConcurrency ?? "ausente"}`);
    }
  }
  for (const key of ["queued", "running", "failed", "failedRecent", "staleRunning", "compensationPending", "compensationDeadLetter", "staleCompensation", "oldestQueuedSeconds", "oldestCompensationSeconds"]) {
    if (!Number.isFinite(Number(totals[key]))) errors.push(`/ops/status totals.${key} no es numerico`);
  }
  const workloadThresholds = requirements.ignoreBacklogPressure === true
    ? {
        ...thresholds,
        maxQueued: Number.MAX_SAFE_INTEGER,
        maxRunning: Number.MAX_SAFE_INTEGER,
        maxOldestQueuedSeconds: Number.MAX_SAFE_INTEGER,
        maxOldestCompensationSeconds: Number.MAX_SAFE_INTEGER
      }
    : thresholds;
  errors.push(...evaluateQueue({
    queued: Number(totals.queued || 0),
    running: Number(totals.running || 0),
    failed: Number(totals.failed || 0),
    failedRecent: Number(totals.failedRecent || 0),
    staleRunning: Number(totals.staleRunning || 0),
    compensationPending: Number(totals.compensationPending || 0),
    compensationDeadLetter: Number(totals.compensationDeadLetter || 0),
    staleCompensation: Number(totals.staleCompensation || 0),
    oldestQueuedSeconds: Number(totals.oldestQueuedSeconds || 0),
    oldestCompensationSeconds: Number(totals.oldestCompensationSeconds || 0)
  }, workloadThresholds).errors.map((error) => `/ops/status ${error}`));
  for (const key of ["received", "processing", "failed", "failedRecent", "staleProcessing", "oldestReceivedSeconds"]) {
    if (!Number.isFinite(Number(inbox[key]))) errors.push(`/ops/status inbox.${key} no es numerico`);
  }
  const inboxThresholds = requirements.ignoreBacklogPressure === true
    ? {
        ...thresholds,
        maxInboxReceived: Number.MAX_SAFE_INTEGER,
        maxInboxProcessing: Number.MAX_SAFE_INTEGER,
        maxOldestInboxSeconds: Number.MAX_SAFE_INTEGER
      }
    : thresholds;
  errors.push(...evaluateInbox({
    received: Number(inbox.received || 0),
    processing: Number(inbox.processing || 0),
    failed: Number(inbox.failed || 0),
    failedRecent: Number(inbox.failedRecent || 0),
    staleProcessing: Number(inbox.staleProcessing || 0),
    oldestReceivedSeconds: Number(inbox.oldestReceivedSeconds || 0)
  }, inboxThresholds).errors.map((error) => `/ops/status ${error}`));

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

async function fetchOpsStatus(appUrl, token, expectedSha, thresholds, requirements = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${appUrl}/ops/status`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal
    });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`/ops/status no devolvio JSON valido: ${text.slice(0, 120)}`);
    }
    if (!response.ok) {
      throw new Error(`/ops/status respondio HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const evaluation = evaluateOpsStatus(payload, expectedSha, thresholds, requirements);
    return { payload, evaluation };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  if (![CONFIRMATION, PRODUCTION_CONFIRMATION].includes(process.env.CONFIRMATION)) {
    throw new Error(`CONFIRMATION debe ser ${CONFIRMATION} o ${PRODUCTION_CONFIRMATION}`);
  }

  const expectedSha = assertExpectedSha(process.env.EXPECTED_RELEASE_SHA);
  const opsStatusToken = assertOpsStatusToken(process.env.OPS_STATUS_TOKEN);
  const appUrl = normalizeAppUrl(
    process.env.OPS_APP_URL || process.env.STAGING_APP_URL || DEFAULT_STAGING_URL
  );
  const maxQueued = integer(process.env.OPS_MAX_QUEUED_JOBS, 20, 0, 100000, "OPS_MAX_QUEUED_JOBS");
  const maxOldestQueuedSeconds = integer(process.env.OPS_MAX_OLDEST_JOB_SECONDS, 300, 1, 86400, "OPS_MAX_OLDEST_JOB_SECONDS");
  const maxRunning = integer(process.env.OPS_MAX_RUNNING_JOBS, 16, 0, 100000, "OPS_MAX_RUNNING_JOBS");
  const maxFailedRecent = integer(process.env.OPS_MAX_FAILED_RECENT_JOBS, 0, 0, 100000, "OPS_MAX_FAILED_RECENT_JOBS");
  const maxStaleRunning = integer(process.env.OPS_MAX_STALE_RUNNING_JOBS, 0, 0, 100000, "OPS_MAX_STALE_RUNNING_JOBS");
  const maxCompensationPending = integer(process.env.OPS_MAX_COMPENSATION_PENDING, 0, 0, 100000, "OPS_MAX_COMPENSATION_PENDING");
  const maxCompensationDeadLetter = integer(process.env.OPS_MAX_COMPENSATION_DEAD_LETTER, 0, 0, 100000, "OPS_MAX_COMPENSATION_DEAD_LETTER");
  const maxStaleCompensation = integer(process.env.OPS_MAX_STALE_COMPENSATION, 0, 0, 100000, "OPS_MAX_STALE_COMPENSATION");
  const maxOldestCompensationSeconds = integer(process.env.OPS_MAX_OLDEST_COMPENSATION_SECONDS, 300, 1, 86400, "OPS_MAX_OLDEST_COMPENSATION_SECONDS");
  const maxInboxReceived = integer(process.env.OPS_MAX_INBOX_RECEIVED, 20, 0, 100000, "OPS_MAX_INBOX_RECEIVED");
  const maxInboxProcessing = integer(process.env.OPS_MAX_INBOX_PROCESSING, 8, 0, 100000, "OPS_MAX_INBOX_PROCESSING");
  const maxInboxFailed = integer(process.env.OPS_MAX_INBOX_FAILED, 0, 0, 100000, "OPS_MAX_INBOX_FAILED");
  const maxInboxFailedRecent = integer(process.env.OPS_MAX_INBOX_FAILED_RECENT, 0, 0, 100000, "OPS_MAX_INBOX_FAILED_RECENT");
  const maxInboxStaleProcessing = integer(process.env.OPS_MAX_INBOX_STALE_PROCESSING, 0, 0, 100000, "OPS_MAX_INBOX_STALE_PROCESSING");
  const maxOldestInboxSeconds = integer(process.env.OPS_MAX_OLDEST_INBOX_SECONDS, 300, 1, 86400, "OPS_MAX_OLDEST_INBOX_SECONDS");
  const maxWorkerAgeSeconds = integer(process.env.OPS_MAX_WORKER_AGE_SECONDS, 60, 5, 3600, "OPS_MAX_WORKER_AGE_SECONDS");
  const minWorkerUptimeSeconds = integer(process.env.OPS_MIN_WORKER_UPTIME_SECONDS, 30, 5, 3600, "OPS_MIN_WORKER_UPTIME_SECONDS");
  const minGenerationConcurrency = integer(process.env.OPS_MIN_GENERATION_CONCURRENCY, 8, 1, 32, "OPS_MIN_GENERATION_CONCURRENCY");
  const minPublicationConcurrency = integer(process.env.OPS_MIN_PUBLICATION_CONCURRENCY, 4, 1, 32, "OPS_MIN_PUBLICATION_CONCURRENCY");
  const minWebhookConcurrency = integer(process.env.OPS_MIN_WEBHOOK_CONCURRENCY, 2, 1, 32, "OPS_MIN_WEBHOOK_CONCURRENCY");
  const profile = readinessProfile(process.env.OPS_READINESS_PROFILE);
  const thresholds = {
    maxQueued,
    maxOldestQueuedSeconds,
    maxRunning,
    maxFailedRecent,
    maxStaleRunning,
    maxCompensationPending,
    maxCompensationDeadLetter,
    maxStaleCompensation,
    maxOldestCompensationSeconds,
    maxInboxReceived,
    maxInboxProcessing,
    maxInboxFailed,
    maxInboxFailedRecent,
    maxInboxStaleProcessing,
    maxOldestInboxSeconds,
    maxWorkerAgeSeconds,
    minWorkerUptimeSeconds,
    minGenerationConcurrency,
    minPublicationConcurrency,
    minWebhookConcurrency
  };
  const requirements = {
    requireRealBilling: profile === "go",
    requireLegalComplete: profile === "go",
    requireAdmissionOpen: profile === "go",
    ignoreBacklogPressure: profile === "rollback"
  };

  const ready = await fetchReady(appUrl, expectedSha);
  const opsStatus = await fetchOpsStatus(appUrl, opsStatusToken, expectedSha, thresholds, requirements);
  const errors = [...ready.evaluation.errors, ...opsStatus.evaluation.errors];
  const result = {
    event: process.env.CONFIRMATION === PRODUCTION_CONFIRMATION
      ? "ops_readiness_production"
      : "ops_readiness_staging",
    ok: errors.length === 0,
    profile,
    appUrl,
    expectedRelease: expectedSha,
    ready: ready.payload,
    opsStatus: opsStatus.payload,
    queue: opsStatus.payload?.totals || null,
    thresholds,
    requirements,
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
  PRODUCTION_CONFIRMATION,
  assertOpsStatusToken,
  assertExpectedSha,
  booleanFlag,
  evaluateOpsStatus,
  evaluateInbox,
  evaluateQueue,
  evaluateReady,
  fetchOpsStatus,
  integer,
  normalizeAppUrl,
  readinessProfile,
  summarizeQueue
};
