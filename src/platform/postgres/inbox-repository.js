"use strict";

const { TenantContext, normalizeShopDomain } = require("../../tenancy/tenant-context");

function mapInboxEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    shopDomain: row.shop_domain,
    topic: row.topic,
    payloadHash: row.payload_hash,
    payload: row.payload || {},
    status: row.status,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 8),
    runAfter: row.run_after,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    lastError: row.last_error,
    apiVersion: row.api_version,
    receivedAt: row.received_at,
    processedAt: row.processed_at,
    updatedAt: row.updated_at
  };
}

function createInboxRepository(pool) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("Se requiere un pool de Postgres");

  async function workerTransaction(workerId, work) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.worker_id', $1, true)", [workerId]);
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return Object.freeze({
    async receive({ id, shopDomain, topic, payloadHash, payload, apiVersion = null }) {
      const shop = normalizeShopDomain(shopDomain);
      if (!id || !shop || !topic || !payloadHash) throw new TypeError("El webhook verificado está incompleto");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.webhook_shop', $1, true)", [shop]);
        const inserted = await client.query(
          `INSERT INTO control_plane.inbox_events
             (id, tenant_id, shop_domain, topic, payload_hash, payload, status, attempts, max_attempts, run_after, api_version)
           VALUES (
             $1,
             (SELECT id FROM control_plane.tenants WHERE shop_domain = $2 LIMIT 1),
             $2, $3, $4, $5, 'received', 0, 8, now(), $6
           )
           ON CONFLICT (id) DO NOTHING
           RETURNING *`,
          [id, shop, topic, payloadHash, payload || {}, apiVersion]
        );
        const selected = inserted.rows[0]
          ? inserted
          : await client.query(
              "SELECT * FROM control_plane.inbox_events WHERE id = $1 AND shop_domain = $2",
              [id, shop]
            );
        const event = mapInboxEvent(selected.rows[0]);
        if (!event) throw new Error("El webhook id ya pertenece a otra tienda");
        if (event.payloadHash !== payloadHash) throw new Error("El webhook id llegó con un payload diferente");
        await client.query("COMMIT");
        return { event, inserted: !!inserted.rows[0] };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async claim(workerId, leaseSeconds = 120) {
      return workerTransaction(workerId, async (client) => {
        const result = await client.query(
          `WITH candidate AS (
             SELECT id
             FROM control_plane.inbox_events
             WHERE (status = 'received' AND run_after <= now())
                OR (status = 'processing' AND locked_at < now() - ($2::int * interval '1 second'))
             ORDER BY run_after, received_at
             FOR UPDATE SKIP LOCKED
             LIMIT 1
           )
           UPDATE control_plane.inbox_events e
           SET status = 'processing', attempts = attempts + 1,
               locked_at = now(), locked_by = $1, updated_at = now()
           FROM candidate
           WHERE e.id = candidate.id
           RETURNING e.*`,
          [workerId, Math.max(30, Number(leaseSeconds) || 120)]
        );
        const event = mapInboxEvent(result.rows[0]);
        if (!event) return null;
        return {
          ...event,
          type: event.topic,
          tenant: TenantContext.fromShopDomain(event.shopDomain, {
            tenantId: event.tenantId || event.shopDomain,
            source: "webhook",
            requestId: event.id
          })
        };
      });
    },

    async succeed(context, event) {
      return workerTransaction(event.lockedBy, async (client) => {
        const result = await client.query(
          `UPDATE control_plane.inbox_events
           SET status = 'processed', processed_at = now(), updated_at = now(),
               locked_at = NULL, locked_by = NULL, last_error = NULL
           WHERE id = $1 AND status = 'processing' AND locked_by = $2
           RETURNING *`,
          [event.id, event.lockedBy]
        );
        return mapInboxEvent(result.rows[0]);
      });
    },

    async fail(context, event, error, retryDelaySeconds) {
      const terminal = Number(event.attempts) >= Number(event.maxAttempts);
      return workerTransaction(event.lockedBy, async (client) => {
        const result = await client.query(
          `UPDATE control_plane.inbox_events
           SET status = $2,
               run_after = CASE WHEN $2 = 'received' THEN now() + ($3::int * interval '1 second') ELSE run_after END,
               last_error = $4, locked_at = NULL, locked_by = NULL, updated_at = now()
           WHERE id = $1 AND status = 'processing' AND locked_by = $5
           RETURNING *`,
          [event.id, terminal ? "failed" : "received", Math.max(1, retryDelaySeconds), String(error?.message || error).slice(0, 1000), event.lockedBy]
        );
        return mapInboxEvent(result.rows[0]);
      });
    },

    async redactShop(workerId, shopDomain, preserveEventId = null) {
      const shop = normalizeShopDomain(shopDomain);
      return workerTransaction(workerId, (client) => client.query(
        `UPDATE control_plane.inbox_events
         SET tenant_id = NULL,
             payload = CASE WHEN id = $2 THEN jsonb_build_object('redacted', true) ELSE '{}'::jsonb END,
             updated_at = now()
         WHERE shop_domain = $1`,
        [shop, preserveEventId]
      ));
    },

    async recordPrivacy(workerId, { event, type, tenantReference, subjectHash = null }) {
      return workerTransaction(workerId, (client) => client.query(
        `INSERT INTO control_plane.privacy_requests
           (id, tenant_id, type, status, received_at, completed_at, webhook_id, subject_hash, updated_at)
         VALUES ($1, $2, $3, 'completed', $4, now(), $5, $6, now())
         ON CONFLICT (webhook_id) WHERE webhook_id IS NOT NULL
         DO UPDATE SET status = 'completed', completed_at = now(), updated_at = now(), last_error = NULL`,
        [event.id, tenantReference, type, event.receivedAt || new Date(), event.id, subjectHash]
      ));
    },

    async purge(workerId, { processedDays = 30, privacyDays = 365 } = {}) {
      return workerTransaction(workerId, async (client) => {
        const processed = await client.query(
          `DELETE FROM control_plane.inbox_events
           WHERE status = 'processed' AND processed_at < now() - ($1::int * interval '1 day')`,
          [Math.max(1, Number(processedDays) || 30)]
        );
        const privacy = await client.query(
          `DELETE FROM control_plane.privacy_requests
           WHERE status = 'completed' AND completed_at < now() - ($1::int * interval '1 day')`,
          [Math.max(1, Number(privacyDays) || 365)]
        );
        return { processed: processed.rowCount || 0, privacy: privacy.rowCount || 0 };
      });
    }
  });
}

module.exports = { createInboxRepository, mapInboxEvent };
