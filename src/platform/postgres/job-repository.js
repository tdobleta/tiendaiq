"use strict";

const crypto = require("crypto");
const { TenantContext, requireTenantContext, assertTenant } = require("../../tenancy/tenant-context");
const { withTenantTransaction } = require("./with-tenant-transaction");

function mapJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    payload: row.payload || {},
    status: row.status,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 0),
    runAfter: row.run_after,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    lastError: row.last_error,
    result: row.result || null,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  };
}

function createJobRepository(pool) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("Se requiere un pool de Postgres");

  return Object.freeze({
    async enqueue(context, { type, payload = {}, idempotencyKey = null, maxAttempts = 5 }) {
      const tenant = requireTenantContext(context);
      if (!type) throw new TypeError("El job requiere type");
      const id = crypto.randomUUID();
      const result = await withTenantTransaction(pool, tenant, (client) => client.query(
        `WITH inserted AS (
           INSERT INTO control_plane.jobs
             (id, tenant_id, type, payload, status, attempts, max_attempts, run_after, idempotency_key)
           VALUES ($1, $2, $3, $4, 'queued', 0, $5, now(), $6)
           ON CONFLICT (tenant_id, type, idempotency_key)
             WHERE idempotency_key IS NOT NULL
           DO NOTHING
           RETURNING *
         )
         SELECT * FROM inserted
         UNION ALL
         SELECT * FROM control_plane.jobs
         WHERE tenant_id = $2 AND type = $3 AND idempotency_key = $6
         LIMIT 1`,
        [id, tenant.tenantId, type, payload, Math.max(1, Number(maxAttempts) || 5), idempotencyKey]
      ));
      return mapJob(result.rows[0]);
    },

    async get(context, id) {
      const tenant = requireTenantContext(context);
      const result = await withTenantTransaction(pool, tenant, (client) => client.query(
        "SELECT * FROM control_plane.jobs WHERE tenant_id = $1 AND id = $2",
        [tenant.tenantId, id]
      ));
      return mapJob(result.rows[0]);
    },

    async claim(workerId, leaseSeconds = 300, jobTypes = null) {
      if (!workerId) throw new TypeError("El worker requiere identidad");
      const allowedTypes = Array.isArray(jobTypes) && jobTypes.length ? jobTypes.map(String) : null;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.worker_id', $1, true)", [workerId]);
        const result = await client.query(
          `WITH candidate AS (
             SELECT id
             FROM control_plane.jobs
             WHERE ($3::text[] IS NULL OR type = ANY($3::text[]))
               AND ((status = 'queued' AND run_after <= now())
                 OR (status = 'running' AND locked_at < now() - ($2::int * interval '1 second')))
             ORDER BY run_after, created_at
             FOR UPDATE SKIP LOCKED
             LIMIT 1
           )
           UPDATE control_plane.jobs j
           SET status = 'running', attempts = attempts + 1,
               locked_at = now(), locked_by = $1, updated_at = now()
           FROM candidate
           WHERE j.id = candidate.id
           RETURNING j.*`,
          [workerId, Math.max(30, Number(leaseSeconds) || 300), allowedTypes]
        );
        await client.query("COMMIT");
        const job = mapJob(result.rows[0]);
        if (!job) return null;
        return { ...job, tenant: TenantContext.fromShopDomain(job.tenantId, { source: "internal-job", requestId: job.id }) };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async stats(workerId = "queue-metrics") {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.worker_id', $1, true)", [workerId]);
        const result = await client.query(
          `SELECT type,
                  count(*) FILTER (WHERE status = 'queued')::int AS queued,
                  count(*) FILTER (WHERE status = 'running')::int AS running,
                  count(*) FILTER (WHERE status = 'failed')::int AS failed,
                  coalesce(extract(epoch FROM (now() - min(created_at) FILTER (WHERE status = 'queued'))), 0)::float8
                    AS oldest_queued_seconds
           FROM control_plane.jobs
           WHERE status IN ('queued', 'running', 'failed')
           GROUP BY type
           ORDER BY type`
        );
        await client.query("COMMIT");
        return result.rows.map((row) => ({
          type: row.type,
          queued: Number(row.queued || 0),
          running: Number(row.running || 0),
          failed: Number(row.failed || 0),
          oldestQueuedSeconds: Number(row.oldest_queued_seconds || 0)
        }));
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async succeed(context, job, result = {}) {
      const tenant = assertTenant(context, job.tenantId);
      const updated = await withTenantTransaction(pool, tenant, (client) => client.query(
        `UPDATE control_plane.jobs
         SET status = 'succeeded', result = $3, last_error = NULL,
             locked_at = NULL, locked_by = NULL, completed_at = now(), updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'running' AND locked_by = $4
         RETURNING *`,
        [tenant.tenantId, job.id, result, job.lockedBy]
      ));
      return mapJob(updated.rows[0]);
    },

    async renew(context, job) {
      const tenant = assertTenant(context, job.tenantId);
      const updated = await withTenantTransaction(pool, tenant, (client) => client.query(
        `UPDATE control_plane.jobs
         SET locked_at = now(), updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'running' AND locked_by = $3
         RETURNING *`,
        [tenant.tenantId, job.id, job.lockedBy]
      ));
      return mapJob(updated.rows[0]);
    },

    async fail(context, job, error, retryDelaySeconds) {
      const tenant = assertTenant(context, job.tenantId);
      const terminal = Number(job.attempts) >= Number(job.maxAttempts);
      const updated = await withTenantTransaction(pool, tenant, (client) => client.query(
        `UPDATE control_plane.jobs
         SET status = $3,
             run_after = CASE WHEN $3 = 'queued' THEN now() + ($4::int * interval '1 second') ELSE run_after END,
             last_error = $5, locked_at = NULL, locked_by = NULL,
             completed_at = CASE WHEN $3 = 'failed' THEN now() ELSE NULL END,
             updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'running' AND locked_by = $6
         RETURNING *`,
        [tenant.tenantId, job.id, terminal ? "failed" : "queued", Math.max(1, retryDelaySeconds), String(error?.message || error).slice(0, 1000), job.lockedBy]
      ));
      return mapJob(updated.rows[0]);
    }
  });
}

module.exports = { createJobRepository, mapJob };
