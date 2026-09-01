"use strict";

const crypto = require("crypto");
const { requireTenantContext } = require("../../tenancy/tenant-context");
const { withTenantTransaction } = require("./with-tenant-transaction");
const { mapJob } = require("./job-repository");

function mapReservation(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    jobId: row.job_id,
    operationType: row.operation_type,
    idempotencyKey: row.idempotency_key,
    period: row.period,
    units: Number(row.units),
    quotaLimit: row.quota_limit == null ? null : Number(row.quota_limit),
    status: row.status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    committedAt: row.committed_at,
    releasedAt: row.released_at
  };
}

function quotaError(limit) {
  const error = new Error(`Usaste las ${limit} páginas gratis de este mes. Pasate a TiendaIQ Pro para generar sin límite.`);
  error.status = 402;
  error.actualizar = true;
  return error;
}

function queueError(kind, limit) {
  const global = kind === "global";
  const error = new Error(global
    ? "La capacidad de generacion esta temporalmente completa. Reintenta en un minuto."
    : "Ya tenes generaciones en proceso. Espera a que termine una antes de crear otra.");
  error.status = global ? 503 : 429;
  error.code = global ? "GENERATION_QUEUE_SATURATED" : "TENANT_GENERATION_LIMIT";
  error.retryAfter = global ? 60 : 30;
  error.limit = limit;
  error.expose = true;
  return error;
}

function createGenerationRepository(pool) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("Se requiere un pool de Postgres");

  async function existing(client, tenantId, idempotencyKey) {
    const found = await client.query(
      `SELECT * FROM control_plane.jobs
       WHERE tenant_id = $1 AND type = 'generate-page' AND idempotency_key = $2
       LIMIT 1`,
      [tenantId, idempotencyKey]
    );
    if (!found.rows[0]) return null;
    const reservation = await client.query(
      "SELECT * FROM control_plane.usage_reservations WHERE tenant_id = $1 AND job_id = $2",
      [tenantId, found.rows[0].id]
    );
    return { job: mapJob(found.rows[0]), reservation: mapReservation(reservation.rows[0]) };
  }

  return Object.freeze({
    async enqueue(context, {
      payload,
      idempotencyKey,
      period,
      limit,
      maxAttempts = 3,
      maxPending = 2,
      maxGlobalPending = 120
    }) {
      const tenant = requireTenantContext(context);
      if (!idempotencyKey || String(idempotencyKey).length > 200) throw new TypeError("La generación requiere una idempotencyKey válida");
      if (!/^\d{4}-\d{2}$/.test(period)) throw new TypeError("La generación requiere un período YYYY-MM");

      return withTenantTransaction(pool, tenant, async (client) => {
        let found = await existing(client, tenant.tenantId, idempotencyKey);
        if (found) return found;

        const shop = await client.query(
          "SELECT datos FROM public.tiendas WHERE dominio = $1 FOR UPDATE",
          [tenant.tenantId]
        );
        if (!shop.rows[0]) throw new Error("El tenant no existe en el registro de tiendas");

        // Otro request con la misma clave pudo esperar el mismo lock.
        found = await existing(client, tenant.tenantId, idempotencyKey);
        if (found) return found;

        const current = Number(shop.rows[0].datos?.uso?.[period] || 0);
        if (limit != null && current >= Number(limit)) throw quotaError(Number(limit));

        // Serializa la decision global (contar + insertar) sin bloquear otros
        // tipos de job. El lock vive solo durante esta transaccion corta.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('tiendaiq:generation-admission', 0))");
        const pressure = await client.query(
          "SELECT queued, running, oldest_queued_seconds FROM control_plane.generation_queue_pressure()"
        );
        const globalPending = Number(pressure.rows[0]?.queued || 0) + Number(pressure.rows[0]?.running || 0);
        const globalLimit = Math.max(1, Number(maxGlobalPending) || 120);
        if (globalPending >= globalLimit) throw queueError("global", globalLimit);

        const pendingResult = await client.query(
          `SELECT count(*)::int AS pending
             FROM control_plane.jobs
            WHERE tenant_id = $1
              AND type = 'generate-page'
              AND status IN ('queued', 'running')`,
          [tenant.tenantId]
        );
        const tenantLimit = Math.max(1, Number(maxPending) || 2);
        if (Number(pendingResult.rows[0]?.pending || 0) >= tenantLimit) {
          throw queueError("tenant", tenantLimit);
        }

        const jobId = crypto.randomUUID();
        const reservationId = crypto.randomUUID();
        const jobPayload = { ...(payload || {}), reservationId };
        const insertedJob = await client.query(
          `INSERT INTO control_plane.jobs
             (id, tenant_id, type, payload, status, attempts, max_attempts, run_after, idempotency_key)
           VALUES ($1, $2, 'generate-page', $3, 'queued', 0, $4, now(), $5)
           RETURNING *`,
          [jobId, tenant.tenantId, jobPayload, Math.max(1, Number(maxAttempts) || 3), idempotencyKey]
        );
        const insertedReservation = await client.query(
          `INSERT INTO control_plane.usage_reservations
             (id, tenant_id, job_id, operation_type, idempotency_key, period, units, quota_limit)
           VALUES ($1, $2, $3, 'page_generation', $4, $5, 1, $6)
           RETURNING *`,
          [reservationId, tenant.tenantId, jobId, idempotencyKey, period, limit]
        );
        await client.query(
          `UPDATE public.tiendas
           SET datos = jsonb_set(
             datos,
             ARRAY['uso'],
             CASE WHEN jsonb_typeof(datos->'uso') = 'object' THEN datos->'uso' ELSE '{}'::jsonb END
               || jsonb_build_object($2::text, $3::int),
             true
           ), actualizada = now()
           WHERE dominio = $1`,
          [tenant.tenantId, period, current + 1]
        );
        return {
          job: mapJob(insertedJob.rows[0]),
          reservation: mapReservation(insertedReservation.rows[0]),
          used: current + 1
        };
      });
    },

    async getReservation(context, id) {
      const tenant = requireTenantContext(context);
      return withTenantTransaction(pool, tenant, async (client) => {
        const result = await client.query(
          "SELECT * FROM control_plane.usage_reservations WHERE tenant_id = $1 AND id = $2",
          [tenant.tenantId, id]
        );
        return mapReservation(result.rows[0]);
      });
    },

    async finalize(context, { reservationId, pageId, page }) {
      const tenant = requireTenantContext(context);
      return withTenantTransaction(pool, tenant, async (client) => {
        const result = await client.query(
          "SELECT * FROM control_plane.usage_reservations WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
          [tenant.tenantId, reservationId]
        );
        const reservation = mapReservation(result.rows[0]);
        if (!reservation) throw new Error("La reserva de generación no existe");
        if (reservation.status === "released") {
          const error = new Error("La reserva de generación ya fue liberada");
          error.nonRetryable = true;
          throw error;
        }
        if (reservation.status === "committed") return reservation;

        await client.query(
          `INSERT INTO public.paginas (tienda, id, datos, actualizada) VALUES ($1, $2, $3, now())
           ON CONFLICT (tienda, id) DO UPDATE SET datos = $3, actualizada = now()`,
          [tenant.tenantId, pageId, page]
        );
        const committed = await client.query(
          `UPDATE control_plane.usage_reservations
           SET status = 'committed', committed_at = now(), updated_at = now(), last_error = NULL
           WHERE tenant_id = $1 AND id = $2 AND status = 'reserved'
           RETURNING *`,
          [tenant.tenantId, reservationId]
        );
        return mapReservation(committed.rows[0]);
      });
    },

    async release(context, reservationId, error) {
      const tenant = requireTenantContext(context);
      return withTenantTransaction(pool, tenant, async (client) => {
        const result = await client.query(
          "SELECT * FROM control_plane.usage_reservations WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
          [tenant.tenantId, reservationId]
        );
        const reservation = mapReservation(result.rows[0]);
        if (!reservation || reservation.status !== "reserved") return reservation;

        const shop = await client.query(
          "SELECT datos FROM public.tiendas WHERE dominio = $1 FOR UPDATE",
          [tenant.tenantId]
        );
        const current = Number(shop.rows[0]?.datos?.uso?.[reservation.period] || 0);
        const next = Math.max(0, current - reservation.units);
        await client.query(
          `UPDATE public.tiendas
           SET datos = jsonb_set(
             datos,
             ARRAY['uso'],
             CASE WHEN jsonb_typeof(datos->'uso') = 'object' THEN datos->'uso' ELSE '{}'::jsonb END
               || jsonb_build_object($2::text, $3::int),
             true
           ), actualizada = now()
           WHERE dominio = $1`,
          [tenant.tenantId, reservation.period, next]
        );
        const released = await client.query(
          `UPDATE control_plane.usage_reservations
           SET status = 'released', released_at = now(), updated_at = now(), last_error = $3
           WHERE tenant_id = $1 AND id = $2 AND status = 'reserved'
           RETURNING *`,
          [tenant.tenantId, reservationId, String(error?.message || error || "").slice(0, 1000)]
        );
        return mapReservation(released.rows[0]);
      });
    }
  });
}

module.exports = { createGenerationRepository, mapReservation, queueError };
