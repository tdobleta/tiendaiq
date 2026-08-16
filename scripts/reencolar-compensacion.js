"use strict";

const crypto = require("crypto");
const { Pool } = require("pg");
const { createPostgresPool } = require("../src/platform/postgres/create-pool");

const CONFIRMATION = "REQUEUE_ONE_COMPENSATION";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTOR = /^[a-z0-9][a-z0-9_.@-]{1,127}$/i;

function parseRecoveryRequest(env = process.env) {
  const jobId = String(env.COMPENSATION_JOB_ID || "").trim();
  const reason = String(env.COMPENSATION_RECOVERY_REASON || "").trim();
  const actor = String(env.COMPENSATION_RECOVERY_ACTOR || "").trim();
  const source = String(env.COMPENSATION_RECOVERY_SOURCE || "").trim();

  if (env.CONFIRMATION !== CONFIRMATION) throw new Error("Confirmacion administrativa invalida");
  if (!UUID.test(jobId)) throw new Error("COMPENSATION_JOB_ID debe ser un UUID");
  if (reason.length < 20 || reason.length > 500) {
    throw new Error("COMPENSATION_RECOVERY_REASON debe tener entre 20 y 500 caracteres");
  }
  if (!ACTOR.test(actor)) throw new Error("COMPENSATION_RECOVERY_ACTOR es invalido");
  if (source.length < 8 || source.length > 500) throw new Error("COMPENSATION_RECOVERY_SOURCE es invalido");
  if (!env.MIGRATION_DATABASE_URL) throw new Error("MIGRATION_DATABASE_URL es obligatoria");

  return Object.freeze({ jobId, reason, actor, source });
}

async function main() {
  const request = parseRecoveryRequest();
  const auditId = crypto.randomUUID();
  const pool = createPostgresPool({
    databaseUrl: process.env.MIGRATION_DATABASE_URL,
    caCertificate: process.env.PG_CA_CERT,
    Pool
  });

  try {
    const result = await pool.query(
      `SELECT *
         FROM control_plane.requeue_compensation_dead_letter($1, $2, $3, $4, $5)`,
      [request.jobId, auditId, request.actor, request.reason, request.source]
    );
    const recovered = result.rows[0];
    if (!recovered) throw new Error("PostgreSQL no confirmo la recuperacion");
    console.log(JSON.stringify({
      auditId,
      jobId: recovered.recovered_job_id,
      previousAttempts: Number(recovered.previous_attempts),
      compensationStatus: recovered.compensation_status,
      requeuedAt: recovered.requeued_at
    }));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`  recuperacion de compensacion fallida: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { CONFIRMATION, parseRecoveryRequest };
