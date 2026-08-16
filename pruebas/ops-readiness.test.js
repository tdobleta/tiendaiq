"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertOpsStatusToken,
  assertExpectedSha,
  booleanFlag,
  evaluateInbox,
  evaluateOpsStatus,
  evaluateQueue,
  evaluateReady,
  integer,
  normalizeAppUrl,
  readinessProfile,
  summarizeQueue
} = require("../scripts/probar-readiness-operativa");

const SHA = "95a81bccac219b9355cf9adb4861a696d9b5caf3";

test("valida el SHA completo que debe responder staging", () => {
  assert.equal(assertExpectedSha(SHA.toUpperCase()), SHA);
  assert.throws(() => assertExpectedSha("95a81b"), /SHA completo/);
});

test("exige token fuerte para consultar /ops/status", () => {
  const token = "ops-status-token-humo-123456789012";
  assert.equal(assertOpsStatusToken(` ${token} `), token);
  assert.throws(() => assertOpsStatusToken("corto"), /al menos 32 caracteres/);
});

test("normaliza la URL de staging sin aceptar protocolos raros", () => {
  assert.equal(normalizeAppUrl("https://tiendaiq-staging-web.onrender.com/"), "https://tiendaiq-staging-web.onrender.com");
  assert.throws(() => normalizeAppUrl("file:///tmp/ready"), /http o https/);
});

test("evalua /ready con Postgres, release y aislamiento RLS", () => {
  const ready = {
    ok: true,
    release: SHA,
    almacenamiento: "postgres",
    aislamiento: {
      enabled: true,
      forced: true,
      protectedTables: 12,
      roleBypassesRls: false,
      inheritsRoles: false,
      workerCapability: false
    }
  };

  assert.deepEqual(evaluateReady(ready, SHA), { ok: true, errors: [] });
  assert.equal(evaluateReady({ ...ready, release: "0".repeat(40) }, SHA).ok, false);
  assert.equal(evaluateReady({ ...ready, aislamiento: { ...ready.aislamiento, workerCapability: true } }, SHA).ok, false);
});

test("evalua /ops/status con release, admission control y cola agregada", () => {
  const opsStatus = {
    ok: true,
    release: SHA,
    billing: { planTest: true },
    legal: { complete: true, missing: [] },
    generationAdmission: { paused: false, retryAfter: 120 },
    inbox: { received: 0, processing: 0, failed: 0, failedRecent: 0, staleProcessing: 0, oldestReceivedSeconds: 0 },
    worker: {
      release: SHA,
      runtimeRole: "tiendaiq_worker_runtime",
      isolationOk: true,
      generationConcurrency: 8,
      publicationConcurrency: 4,
      webhookConcurrency: 2,
      ageSeconds: 10,
      uptimeSeconds: 40,
      activeWorkers: 1,
      releaseVariants: 1,
      runtimeRoleVariants: 1
    },
    queue: [
      { type: "generate-page", queued: 2, running: 1, failed: 0, failedRecent: 0, staleRunning: 0, compensationPending: 0, compensationDeadLetter: 0, staleCompensation: 0, oldestQueuedSeconds: 30, oldestCompensationSeconds: 0 }
    ],
    totals: { queued: 2, running: 1, failed: 0, failedRecent: 0, staleRunning: 0, compensationPending: 0, compensationDeadLetter: 0, staleCompensation: 0, oldestQueuedSeconds: 30, oldestCompensationSeconds: 0 }
  };
  const thresholds = {
    maxQueued: 20,
    maxOldestQueuedSeconds: 600,
    maxRunning: 10,
    maxFailedRecent: 0,
    maxStaleRunning: 0,
    maxCompensationPending: 0,
    maxCompensationDeadLetter: 0,
    maxStaleCompensation: 0,
    maxOldestCompensationSeconds: 300,
    maxInboxReceived: 20,
    maxInboxProcessing: 8,
    maxInboxFailed: 0,
    maxInboxFailedRecent: 0,
    maxInboxStaleProcessing: 0,
    maxOldestInboxSeconds: 300,
    maxWorkerAgeSeconds: 60,
    minWorkerUptimeSeconds: 30,
    minGenerationConcurrency: 8,
    minPublicationConcurrency: 4,
    minWebhookConcurrency: 2
  };

  assert.deepEqual(evaluateOpsStatus(opsStatus, SHA, thresholds), { ok: true, errors: [] });
  assert.equal(evaluateOpsStatus(opsStatus, SHA, thresholds, { requireRealBilling: true }).ok, false);
  assert.equal(evaluateOpsStatus({
    ...opsStatus,
    billing: { planTest: false },
    legal: { complete: false, missing: ["email de soporte"] }
  }, SHA, thresholds, { requireLegalComplete: true }).ok, false);
  assert.equal(evaluateOpsStatus({ ...opsStatus, release: "0".repeat(40) }, SHA, thresholds).ok, false);
  assert.equal(evaluateOpsStatus({
    ...opsStatus,
    totals: { ...opsStatus.totals, oldestQueuedSeconds: 601 }
  }, SHA, thresholds).ok, false);
  assert.equal(evaluateOpsStatus({
    ...opsStatus,
    totals: { ...opsStatus.totals, compensationPending: 1, oldestCompensationSeconds: 1 }
  }, SHA, thresholds).ok, false);
  assert.equal(evaluateOpsStatus({
    ...opsStatus,
    totals: { ...opsStatus.totals, compensationDeadLetter: 1 }
  }, SHA, thresholds).ok, false);
  assert.equal(evaluateOpsStatus({
    ...opsStatus,
    totals: { ...opsStatus.totals, staleCompensation: 1 }
  }, SHA, thresholds).ok, false);
  assert.equal(evaluateOpsStatus({
    ...opsStatus,
    inbox: { ...opsStatus.inbox, failed: 1 }
  }, SHA, thresholds).ok, false);
  assert.equal(evaluateOpsStatus({
    ...opsStatus,
    inbox: { ...opsStatus.inbox, staleProcessing: 1 }
  }, SHA, thresholds).ok, false);
  assert.equal(evaluateOpsStatus({
    ...opsStatus,
    inbox: { ...opsStatus.inbox, oldestReceivedSeconds: 301 }
  }, SHA, thresholds).ok, false);
  assert.equal(evaluateOpsStatus({
    ...opsStatus,
    generationAdmission: { paused: "no", retryAfter: 120 }
  }, SHA, thresholds).ok, false);
  assert.equal(evaluateOpsStatus({
    ...opsStatus,
    generationAdmission: { paused: true, retryAfter: 120 }
  }, SHA, thresholds).ok, true);
  assert.equal(evaluateOpsStatus({
    ...opsStatus,
    generationAdmission: { paused: true, retryAfter: 120 }
  }, SHA, thresholds, { requireAdmissionOpen: true }).ok, false);
  assert.equal(evaluateOpsStatus({
    ...opsStatus,
    worker: { ...opsStatus.worker, ageSeconds: 61 }
  }, SHA, thresholds).ok, false);
  assert.equal(evaluateOpsStatus({
    ...opsStatus,
    worker: { ...opsStatus.worker, uptimeSeconds: 29 }
  }, SHA, thresholds).ok, false);
  assert.equal(evaluateOpsStatus({
    ...opsStatus,
    worker: { ...opsStatus.worker, generationConcurrency: 0 }
  }, SHA, thresholds).ok, false);
  assert.equal(evaluateOpsStatus({
    ...opsStatus,
    worker: { ...opsStatus.worker, activeWorkers: 2, releaseVariants: 2 }
  }, SHA, thresholds).ok, false);
});

test("bloquea webhooks terminales, estancados o demasiado viejos", () => {
  const thresholds = {
    maxInboxReceived: 20,
    maxInboxProcessing: 8,
    maxInboxFailed: 0,
    maxInboxFailedRecent: 0,
    maxInboxStaleProcessing: 0,
    maxOldestInboxSeconds: 300
  };
  const healthy = {
    received: 2,
    processing: 1,
    failed: 0,
    failedRecent: 0,
    staleProcessing: 0,
    oldestReceivedSeconds: 20
  };
  assert.deepEqual(evaluateInbox(healthy, thresholds), { ok: true, errors: [] });
  assert.equal(evaluateInbox({ ...healthy, failedRecent: 1 }, thresholds).ok, false);
  assert.equal(evaluateInbox({ ...healthy, processing: 9 }, thresholds).ok, false);
  assert.equal(evaluateInbox({ ...healthy, received: 21 }, thresholds).ok, false);
});

test("resume la cola durable y aplica umbrales operativos", () => {
  const summary = summarizeQueue([
    { type: "generate-page", queued: 3, running: 2, failed: 1, failedRecent: 0, staleRunning: 0, compensationPending: 0, compensationDeadLetter: 0, staleCompensation: 0, oldestQueuedSeconds: 42.5, oldestCompensationSeconds: 0 },
    { type: "publish-page", queued: 1, running: 0, failed: 0, failedRecent: 0, staleRunning: 0, compensationPending: 0, compensationDeadLetter: 0, staleCompensation: 0, oldestQueuedSeconds: 12, oldestCompensationSeconds: 0 }
  ]);
  assert.deepEqual(summary, {
    types: 2,
    queued: 4,
    running: 2,
    failed: 1,
    failedRecent: 0,
    staleRunning: 0,
    compensationPending: 0,
    compensationDeadLetter: 0,
    staleCompensation: 0,
    oldestQueuedSeconds: 42.5,
    oldestCompensationSeconds: 0
  });
  assert.deepEqual(evaluateQueue(summary, {
    maxQueued: 20,
    maxOldestQueuedSeconds: 600,
    maxRunning: 10,
    maxFailedRecent: 0,
    maxStaleRunning: 0,
    maxCompensationPending: 0,
    maxCompensationDeadLetter: 0,
    maxStaleCompensation: 0,
    maxOldestCompensationSeconds: 300
  }), { ok: true, errors: [] });
  assert.equal(evaluateQueue(summary, {
    maxQueued: 20,
    maxOldestQueuedSeconds: 10,
    maxRunning: 10,
    maxFailedRecent: 0,
    maxStaleRunning: 0,
    maxCompensationPending: 0,
    maxCompensationDeadLetter: 0,
    maxStaleCompensation: 0,
    maxOldestCompensationSeconds: 300
  }).ok, false);
});

test("parsea enteros de entorno con limites explicitos", () => {
  assert.equal(integer("", 600, 1, 1000, "X"), 600);
  assert.throws(() => integer("0", 600, 1, 1000, "X"), /X debe ser/);
  assert.throws(() => integer("1.5", 600, 1, 1000, "X"), /X debe ser/);
});

test("parsea banderas booleanas de GO estricto", () => {
  assert.equal(booleanFlag("1"), true);
  assert.equal(booleanFlag("true"), true);
  assert.equal(booleanFlag("si"), true);
  assert.equal(booleanFlag("0"), false);
  assert.equal(booleanFlag(""), false);
});

test("el perfil de readiness separa preflight tecnico de certificacion GO", () => {
  assert.equal(readinessProfile(""), "technical_preflight");
  assert.equal(readinessProfile("go"), "go");
  assert.throws(() => readinessProfile("casi-go"), /technical_preflight o go/);
});
