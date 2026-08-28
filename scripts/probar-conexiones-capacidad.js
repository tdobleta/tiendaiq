"use strict";

const { Pool } = require("pg");
const { createPostgresPool } = require("../src/platform/postgres/create-pool");
const { assertAuthorized, cleanupFailureClass, cleanupFailureOrigin } = require("./probar-capacidad-cola");

const REMOTE_AUTHORIZATION = "I_UNDERSTAND_THIS_WRITES_SYNTHETIC_STAGING_DATA";
const WEB_RUNTIME_ROLE = "tiendaiq_web_runtime";
const WORKER_RUNTIME_ROLE = "tiendaiq_worker_runtime";

function reviewedSha(value) {
  const sha = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("EXPECTED_RELEASE_SHA debe ser un SHA completo revisado");
  return sha;
}

async function probeConnection(pool) {
  let stage = "connect";
  let client;
  try {
    client = await pool.connect();
    stage = "select_1";
    await client.query("SELECT 1");
    return { ok: true };
  } catch (error) {
    // No raw database or runtime values leave this process. The caller gets
    // only a fixed, reviewed taxonomy suitable for a GitHub summary.
    return {
      ok: false,
      failureClass: cleanupFailureClass(error),
      failureOrigin: cleanupFailureOrigin(error),
      failureStage: stage
    };
  } finally {
    client?.release();
  }
}

async function main() {
  if (process.env.ALLOW_CONNECTIVITY_PROBE !== "1") {
    throw new Error("Defina ALLOW_CONNECTIVITY_PROBE=1 para autorizar el probe de sólo lectura");
  }
  if (process.env.ALLOW_REMOTE_QUEUE_LOAD_TEST !== REMOTE_AUTHORIZATION) {
    throw new Error("Falta autorización remota explícita para el probe");
  }

  const release = reviewedSha(process.env.EXPECTED_RELEASE_SHA);
  const webUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  const workerUrl = process.env.TEST_WORKER_DATABASE_URL;
  assertAuthorized(webUrl, "TEST_DATABASE_URL");
  assertAuthorized(workerUrl, "TEST_WORKER_DATABASE_URL");

  const webPool = createPostgresPool({
    databaseUrl: webUrl,
    caCertificate: process.env.PG_CA_CERT,
    runtimeRole: WEB_RUNTIME_ROLE,
    Pool
  });
  const workerPool = createPostgresPool({
    databaseUrl: workerUrl,
    caCertificate: process.env.PG_CA_CERT,
    runtimeRole: WORKER_RUNTIME_ROLE,
    Pool
  });

  try {
    const probe = {
      web: await probeConnection(webPool),
      worker: await probeConnection(workerPool)
    };
    const passed = probe.web.ok && probe.worker.ok;
    console.log(JSON.stringify({ event: "queue_load_connection_probe", passed, mode: "probe", release, probe }));
    if (!passed) process.exitCode = 1;
  } finally {
    await Promise.all([webPool.end(), workerPool.end()]);
  }
}

if (require.main === module) {
  main().catch(() => {
    // The detailed failure remains in process memory only. The workflow's
    // sanitiser intentionally receives no raw message, code, stack or URL.
    console.log(JSON.stringify({ event: "queue_load_connection_probe", passed: false, mode: "probe" }));
    process.exitCode = 2;
  });
}

module.exports = { probeConnection, reviewedSha };
