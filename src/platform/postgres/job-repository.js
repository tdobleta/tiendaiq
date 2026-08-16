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
    leaseExpiresAt: row.lease_expires_at || null,
    lockedBy: row.locked_by,
    lastError: row.last_error,
    result: row.result || null,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    compensationStatus: row.compensation_status || null,
    compensationAttempts: Number(row.compensation_attempts || 0),
    compensationRunAfter: row.compensation_run_after || null,
    compensationLockedAt: row.compensation_locked_at || null,
    compensationLeaseExpiresAt: row.compensation_lease_expires_at || null,
    compensationLockedBy: row.compensation_locked_by || null,
    compensationLastError: row.compensation_last_error || null,
    compensatedAt: row.compensated_at || null
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

    // Serializes one logical operation per tenant while it is waiting or running.
    // The tenant row is the stable lock target, so distinct request UUIDs cannot
    // create concurrent external side effects for the same shop.
    async enqueueExclusive(context, { type, payload = {}, idempotencyKey = null, maxAttempts = 5 }) {
      const tenant = requireTenantContext(context);
      if (!type) throw new TypeError("El job requiere type");
      const id = crypto.randomUUID();
      return withTenantTransaction(pool, tenant, async (client) => {
        const shop = await client.query(
          "SELECT dominio FROM public.tiendas WHERE dominio = $1 FOR UPDATE",
          [tenant.tenantId]
        );
        if (!shop.rows[0]) throw new Error("La tienda no existe para encolar el job exclusivo");

        const active = await client.query(
          `SELECT *
             FROM control_plane.jobs
            WHERE tenant_id = $1 AND type = $2 AND status IN ('queued', 'running')
            ORDER BY created_at
            LIMIT 1`,
          [tenant.tenantId, type]
        );
        if (active.rows[0]) return mapJob(active.rows[0]);

        const inserted = await client.query(
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
        );
        return mapJob(inserted.rows[0]);
      });
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
                 OR (status = 'running' AND coalesce(
                   lease_expires_at,
                   locked_at + interval '1 hour',
                   '-infinity'::timestamptz
                 ) < now()))
             ORDER BY run_after, created_at
             FOR UPDATE SKIP LOCKED
             LIMIT 1
           )
           UPDATE control_plane.jobs j
           SET status = 'running', attempts = attempts + 1,
               locked_at = now(), lease_expires_at = now() + ($2::int * interval '1 second'),
               locked_by = $1, updated_at = now()
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
        const result = await client.query("SELECT * FROM control_plane.operational_queue_status()");
        await client.query("COMMIT");
        return result.rows.map((row) => ({
          type: row.type,
          queued: Number(row.queued || 0),
          running: Number(row.running || 0),
          failed: Number(row.failed || 0),
          failedRecent: Number(row.failed_recent || 0),
          staleRunning: Number(row.stale_running || 0),
          compensationPending: Number(row.compensation_pending || 0),
          compensationDeadLetter: Number(row.compensation_dead_letter || 0),
          staleCompensation: Number(row.stale_compensation || 0),
          oldestQueuedSeconds: Number(row.oldest_queued_seconds || 0),
          oldestCompensationSeconds: Number(row.oldest_compensation_seconds || 0)
        }));
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async recordHeartbeat({ workerId, releaseSha, runtimeRole, isolationOk, capacity }) {
      if (!workerId) throw new TypeError("El heartbeat requiere workerId");
      if (!/^[a-f0-9]{40}$/.test(String(releaseSha || ""))) {
        throw new TypeError("El heartbeat requiere un SHA completo");
      }
      if (runtimeRole !== "tiendaiq_worker_runtime") {
        throw new TypeError("El heartbeat requiere el rol runtime aislado del worker");
      }
      const capacityValues = [capacity?.generations, capacity?.publications, capacity?.webhooks];
      if (capacityValues.some((value) => !Number.isInteger(value) || value < 1 || value > 32)) {
        throw new TypeError("El heartbeat requiere capacidades enteras entre 1 y 32");
      }
      if (isolationOk !== true) {
        throw new TypeError("El heartbeat requiere aislamiento verificado");
      }
      await pool.query(
        "SELECT control_plane.record_worker_heartbeat($1, $2, $3, $4, $5)",
        [workerId, releaseSha, capacity.generations, capacity.publications, capacity.webhooks]
      );
    },

    async workerStatus() {
      const result = await pool.query("SELECT * FROM control_plane.operational_worker_status()");
      const row = result.rows[0];
      if (!row) return null;
      return {
        workerId: row.worker_id,
        release: row.release_sha,
        runtimeRole: row.runtime_role,
        isolationOk: row.isolation_ok === true,
        generationConcurrency: Number(row.generation_concurrency || 0),
        publicationConcurrency: Number(row.publication_concurrency || 0),
        webhookConcurrency: Number(row.webhook_concurrency || 0),
        ageSeconds: Number(row.age_seconds || 0),
        uptimeSeconds: Number(row.uptime_seconds || 0),
        startedAt: row.started_at,
        lastSeenAt: row.last_seen_at,
        activeWorkers: Number(row.active_workers || 0),
        releaseVariants: Number(row.release_variants || 0),
        runtimeRoleVariants: Number(row.runtime_role_variants || 0)
      };
    },

    async succeed(context, job, result = {}) {
      const tenant = assertTenant(context, job.tenantId);
      const updated = await withTenantTransaction(pool, tenant, (client) => client.query(
        `UPDATE control_plane.jobs
         SET status = 'succeeded', result = $3, last_error = NULL,
             locked_at = NULL, lease_expires_at = NULL, locked_by = NULL,
             completed_at = now(), updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'running' AND locked_by = $4
         RETURNING *`,
        [tenant.tenantId, job.id, result, job.lockedBy]
      ));
      return mapJob(updated.rows[0]);
    },

    async renew(context, job, leaseSeconds = 300) {
      const tenant = assertTenant(context, job.tenantId);
      const updated = await withTenantTransaction(pool, tenant, (client) => client.query(
        `UPDATE control_plane.jobs
         SET locked_at = now(), lease_expires_at = now() + ($4::int * interval '1 second'), updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'running' AND locked_by = $3
         RETURNING *`,
        [tenant.tenantId, job.id, job.lockedBy, Math.max(30, Number(leaseSeconds) || 300)]
      ));
      return mapJob(updated.rows[0]);
    },

    async fail(context, job, error, retryDelaySeconds, needsCompensation = false) {
      const tenant = assertTenant(context, job.tenantId);
      const terminal = Number(job.attempts) >= Number(job.maxAttempts);
      const updated = await withTenantTransaction(pool, tenant, (client) => client.query(
        `UPDATE control_plane.jobs
         SET status = $3,
             run_after = CASE WHEN $3 = 'queued' THEN now() + ($4::int * interval '1 second') ELSE run_after END,
             last_error = $5, locked_at = NULL, lease_expires_at = NULL, locked_by = NULL,
             completed_at = CASE WHEN $3 = 'failed' THEN now() ELSE NULL END,
             compensation_status = CASE
               WHEN $3 = 'failed' AND $7::boolean THEN 'pending'
               ELSE compensation_status
             END,
             compensation_run_after = CASE
               WHEN $3 = 'failed' AND $7::boolean THEN now()
               ELSE compensation_run_after
             END,
             compensation_last_error = CASE
               WHEN $3 = 'failed' AND $7::boolean THEN NULL
               ELSE compensation_last_error
             END,
             updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'running' AND locked_by = $6
         RETURNING *`,
        [tenant.tenantId, job.id, terminal ? "failed" : "queued", Math.max(1, retryDelaySeconds), String(error?.message || error).slice(0, 1000), job.lockedBy, needsCompensation === true]
      ));
      return mapJob(updated.rows[0]);
    },

    async claimCompensation(workerId, leaseSeconds = 300, jobTypes = null) {
      if (!workerId) throw new TypeError("La compensacion requiere identidad worker");
      const allowedTypes = Array.isArray(jobTypes) && jobTypes.length ? jobTypes.map(String) : null;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.worker_id', $1, true)", [workerId]);
        const result = await client.query(
          `WITH candidate AS (
             SELECT id
               FROM control_plane.jobs
              WHERE status = 'failed'
                AND ($3::text[] IS NULL OR type = ANY($3::text[]))
                AND ((compensation_status = 'pending' AND compensation_run_after <= now())
                  OR (compensation_status = 'running'
                    AND coalesce(
                      compensation_lease_expires_at,
                      compensation_locked_at + interval '1 hour',
                      '-infinity'::timestamptz
                    ) < now()))
              ORDER BY compensation_run_after, completed_at
              FOR UPDATE SKIP LOCKED
              LIMIT 1
           )
           UPDATE control_plane.jobs j
              SET compensation_status = 'running',
                  compensation_attempts = compensation_attempts + 1,
                  compensation_locked_at = now(),
                  compensation_lease_expires_at = now() + ($2::int * interval '1 second'),
                  compensation_locked_by = $1,
                  updated_at = now()
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
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async completeCompensation(context, job) {
      const tenant = assertTenant(context, job.tenantId);
      const updated = await withTenantTransaction(pool, tenant, (client) => client.query(
        `UPDATE control_plane.jobs
            SET compensation_status = 'succeeded', compensation_last_error = NULL,
                compensation_locked_at = NULL, compensation_lease_expires_at = NULL,
                compensation_locked_by = NULL,
                compensated_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'failed'
            AND compensation_status = 'running' AND compensation_locked_by = $3
          RETURNING *`,
        [tenant.tenantId, job.id, job.compensationLockedBy]
      ));
      return mapJob(updated.rows[0]);
    },

    async renewCompensation(context, job, leaseSeconds = 300) {
      const tenant = assertTenant(context, job.tenantId);
      const updated = await withTenantTransaction(pool, tenant, (client) => client.query(
        `UPDATE control_plane.jobs
            SET compensation_locked_at = now(),
                compensation_lease_expires_at = now() + ($4::int * interval '1 second'),
                updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'failed'
            AND compensation_status = 'running' AND compensation_locked_by = $3
          RETURNING *`,
        [tenant.tenantId, job.id, job.compensationLockedBy, Math.max(30, Number(leaseSeconds) || 300)]
      ));
      return mapJob(updated.rows[0]);
    },

    async failCompensation(context, job, error, retryDelaySeconds, terminal = false) {
      const tenant = assertTenant(context, job.tenantId);
      const updated = await withTenantTransaction(pool, tenant, (client) => client.query(
        `UPDATE control_plane.jobs
            SET compensation_status = CASE WHEN $6::boolean THEN 'dead_letter' ELSE 'pending' END,
                compensation_run_after = CASE
                  WHEN $6::boolean THEN compensation_run_after
                  ELSE now() + ($4::int * interval '1 second')
                END,
                compensation_last_error = $5,
                compensation_locked_at = NULL, compensation_lease_expires_at = NULL,
                compensation_locked_by = NULL,
                updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'failed'
            AND compensation_status = 'running' AND compensation_locked_by = $3
          RETURNING *`,
        [tenant.tenantId, job.id, job.compensationLockedBy, Math.max(1, Number(retryDelaySeconds) || 5), String(error?.message || error).slice(0, 1000), terminal === true]
      ));
      return mapJob(updated.rows[0]);
    }
  });
}

module.exports = { createJobRepository, mapJob };
