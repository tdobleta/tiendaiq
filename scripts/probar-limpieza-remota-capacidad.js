"use strict";

const ORIGIN = "https://tiendaiq-partner-staging-web.onrender.com";
const CONFIRMATION = "CLEAN_PARTNER_STAGING_QUEUE_CAPACITY";
const REMOTE_FAILURE_STAGES = Object.freeze([
  "command_invalid",
  "init_request_failed",
  "init_rejected",
  "init_not_found",
  "init_conflict",
  "init_invalid_response",
  "init_unexpected_status",
  "poll_request_failed",
  "poll_rejected",
  "poll_not_found",
  "poll_conflict",
  "poll_invalid_result",
  "poll_unexpected_status",
  "poll_timeout"
]);

function allowedStatus(status) {
  const numeric = Number(status);
  return Number.isInteger(numeric) && numeric >= 100 && numeric <= 599 ? numeric : undefined;
}

function cleanupFailure(stage, status) {
  if (!REMOTE_FAILURE_STAGES.includes(stage)) throw new TypeError("etapa de cleanup remoto invalida");
  const error = new Error("La limpieza remota no pudo continuar");
  error.cleanupRemoteDiagnostic = Object.freeze({
    stage,
    ...(allowedStatus(status) !== undefined ? { status: allowedStatus(status) } : {})
  });
  return error;
}

function cleanupFailureEvent(error) {
  const diagnostic = error?.cleanupRemoteDiagnostic;
  const stage = REMOTE_FAILURE_STAGES.includes(diagnostic?.stage) ? diagnostic.stage : "command_invalid";
  const status = allowedStatus(diagnostic?.status);
  return {
    event: "capacity_remote_cleanup_failure",
    mode: "cleanup",
    phase: "remote_cleanup",
    failure: { stage, ...(status !== undefined ? { status } : {}) }
  };
}

function command(env = process.env) {
  const runId = String(env.LOAD_CLEANUP_RUN_ID || "").trim().toLowerCase();
  const tenants = Number(env.CLEANUP_TENANTS);
  const token = String(env.OPS_STATUS_TOKEN || "").trim();
  if (!/^[a-f0-9]{12}$/.test(runId)) throw new Error("LOAD_CLEANUP_RUN_ID invalido");
  if (!Number.isInteger(tenants) || tenants < 1 || tenants > 2000) throw new Error("CLEANUP_TENANTS invalido");
  if (token.length < 32) throw new Error("OPS_STATUS_TOKEN invalido");
  return { runId, tenants, token };
}

async function request(url, options, { fetchFn = fetch, failureStage } = {}) {
  let response;
  try {
    response = await fetchFn(url, { ...options, redirect: "error", signal: AbortSignal.timeout(10_000) });
  } catch {
    throw cleanupFailure(failureStage);
  }
  let body = {};
  try { body = await response.json(); } catch {}
  return { status: response.status, body };
}

function initFailureStage(status, hasValidJobId) {
  if (status === 202 && !hasValidJobId) return "init_invalid_response";
  if (status === 401 || status === 403) return "init_rejected";
  if (status === 404) return "init_not_found";
  if (status === 409) return "init_conflict";
  return "init_unexpected_status";
}

function pollFailureStage(status, completed) {
  if (status === 200 && !completed) return "poll_invalid_result";
  if (status === 401 || status === 403) return "poll_rejected";
  if (status === 404) return "poll_not_found";
  if (status === 409) return "poll_conflict";
  return "poll_unexpected_status";
}

async function cleanupRemote(config, { fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const query = new URLSearchParams({ run_id: config.runId, tenants: String(config.tenants) });
  const url = `${ORIGIN}/ops/capacity-cleanup?${query}`;
  const headers = { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" };
  const start = await request(url, {
    method: "POST", headers, body: JSON.stringify({ confirmation: CONFIRMATION })
  }, { fetchFn, failureStage: "init_request_failed" });
  const jobId = String(start.body?.jobId || "");
  if (start.status !== 202 || !/^[a-f0-9-]{36}$/i.test(jobId)) {
    throw cleanupFailure(initFailureStage(start.status, /^[a-f0-9-]{36}$/i.test(jobId)), start.status);
  }
  const statusUrl = `${url}&job_id=${encodeURIComponent(jobId)}`;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const status = await request(statusUrl, { headers: { Authorization: `Bearer ${config.token}` } }, {
      fetchFn,
      failureStage: "poll_request_failed"
    });
    if (status.status === 200 && status.body?.completed === true && status.body?.tenantsDeleted === config.tenants) {
      return { passed: true, mode: "cleanup", runId: config.runId, tenantsDeleted: config.tenants };
    }
    if (status.status !== 202) {
      throw cleanupFailure(
        pollFailureStage(status.status, status.body?.completed === true && status.body?.tenantsDeleted === config.tenants),
        status.status
      );
    }
    await sleep(2000);
  }
  throw cleanupFailure("poll_timeout");
}

if (require.main === module) {
  Promise.resolve()
    .then(() => cleanupRemote(command()))
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.log(JSON.stringify(cleanupFailureEvent(error)));
      process.exitCode = 2;
    });
}

module.exports = {
  ORIGIN,
  CONFIRMATION,
  REMOTE_FAILURE_STAGES,
  command,
  cleanupRemote,
  cleanupFailureEvent
};
