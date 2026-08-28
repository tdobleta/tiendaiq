"use strict";

const PARTNER_STAGING_ORIGIN = "https://tiendaiq-partner-staging-web.onrender.com";

function reviewedSha(value) {
  const sha = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("EXPECTED_RELEASE_SHA debe ser un SHA completo revisado");
  return sha;
}

function failure() {
  return { ok: false, failureClass: "connection", failureOrigin: "runtime", failureStage: "ops_status" };
}

function probeFromOperationalStatus(status, release) {
  const web = status?.ok === true && status?.release === release ? { ok: true } : failure();
  const worker = status?.worker;
  const workerReady = worker
    && worker.release === release
    && worker.runtimeRole === "tiendaiq_worker_runtime"
    && worker.isolationOk === true
    && Number(worker.activeWorkers) >= 1;
  return { web, worker: workerReady ? { ok: true } : failure() };
}

async function probeRuntimeStatus({ fetchImpl = fetch, token, release, appOrigin = PARTNER_STAGING_ORIGIN }) {
  const origin = new URL(appOrigin);
  if (origin.origin !== PARTNER_STAGING_ORIGIN || origin.pathname !== "/") {
    throw new Error("El probe solo puede consultar el runtime Partner Staging fijado");
  }
  if (String(token || "").length < 32) throw new Error("OPS_STATUS_TOKEN debe ser fuerte");

  let response;
  try {
    response = await fetchImpl(`${PARTNER_STAGING_ORIGIN}/ops/status`, {
      method: "GET",
      redirect: "error",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    return { web: failure(), worker: failure() };
  }
  if (!response?.ok) return { web: failure(), worker: failure() };

  try {
    return probeFromOperationalStatus(await response.json(), release);
  } catch {
    return { web: failure(), worker: failure() };
  }
}

async function main() {
  if (process.env.ALLOW_CONNECTIVITY_PROBE !== "1") {
    throw new Error("Defina ALLOW_CONNECTIVITY_PROBE=1 para autorizar el probe de solo lectura");
  }
  const release = reviewedSha(process.env.EXPECTED_RELEASE_SHA);
  const probe = await probeRuntimeStatus({ token: process.env.OPS_STATUS_TOKEN, release });
  const passed = probe.web.ok && probe.worker.ok;
  console.log(JSON.stringify({ event: "queue_load_connection_probe", passed, mode: "probe", release, probe }));
  if (!passed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(() => {
    // Never emit the received status, token, URL or a remote error.
    console.log(JSON.stringify({ event: "queue_load_connection_probe", passed: false, mode: "probe" }));
    process.exitCode = 2;
  });
}

module.exports = { probeRuntimeStatus, probeFromOperationalStatus, reviewedSha };
