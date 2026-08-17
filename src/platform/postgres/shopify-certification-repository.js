"use strict";

const { requireTenantContext } = require("../../tenancy/tenant-context");
const { withTenantTransaction } = require("./with-tenant-transaction");

const PRIVACY_TYPES = Object.freeze(["customers_data_request", "customers_redact"]);

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function createShopifyCertificationRepository(pool) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("Se requiere un pool de Postgres");

  return Object.freeze({
    async read(context, { since, pageId, releaseSha }) {
      const tenant = requireTenantContext(context);
      if (!(since instanceof Date) || !Number.isFinite(since.getTime())) {
        throw new TypeError("since debe ser una fecha valida");
      }
      if (!String(pageId || "").trim()) throw new TypeError("pageId es obligatorio");
      const expectedRelease = String(releaseSha || "").trim().toLowerCase();
      if (!/^[a-f0-9]{40}$/.test(expectedRelease)) {
        throw new TypeError("releaseSha debe ser un SHA completo");
      }

      return withTenantTransaction(pool, tenant, async (client) => {
        const [publication, privacy] = await Promise.all([
          client.query(
            `SELECT p.id AS page_id,
                    p.datos->>'shopify_product_id' AS shopify_product_id,
                    p.datos->>'last_completed_job_id' AS job_id,
                    p.datos->>'url_publica' AS public_url,
                    p.datos->>'published_content_hash' AS content_hash,
                    p.datos->>'cambios_sin_publicar' AS changes_pending,
                    p.datos->>'last_job_error' AS last_job_error,
                    j.completed_at,
                    j.status AS job_status,
                    j.type AS job_type,
                    j.worker_release_sha
              FROM public.paginas p
              JOIN control_plane.jobs j
                ON j.tenant_id = p.tienda
                AND j.id::text = p.datos->>'last_completed_job_id'
              WHERE p.tienda = $1
                AND p.id = $3
                AND p.actualizada >= $2
                AND p.datos->>'estado' = 'publicada'
                AND p.datos->>'active_job_id' IS NULL
                AND coalesce((p.datos->>'cambios_sin_publicar')::boolean, false) = false
                AND nullif(p.datos->>'last_job_error', '') IS NULL
                AND p.datos->>'shopify_product_id' LIKE 'gid://shopify/Product/%'
                AND p.datos->>'published_content_hash' ~ '^[a-f0-9]{64}$'
                AND j.type = 'publish-page'
                AND j.status = 'succeeded'
                AND j.completed_at >= $2
                AND j.worker_release_sha = $4
              LIMIT 1`,
            [tenant.tenantId, since, String(pageId), expectedRelease]
          ),
          client.query(
            `SELECT pr.type, max(pr.completed_at) AS completed_at, count(*)::int AS evidence_count,
                    max(pr.worker_release_sha) AS worker_release_sha
               FROM control_plane.privacy_requests pr
               JOIN control_plane.inbox_events e
                 ON e.id = pr.webhook_id
                AND e.tenant_id = pr.tenant_id
                AND replace(e.topic, '/', '_') = pr.type
              WHERE pr.tenant_id = $1
                AND pr.status = 'completed'
                AND pr.type = ANY($2::text[])
                AND pr.completed_at >= $3
                AND pr.worker_release_sha = $4
                AND e.status = 'processed'
                AND e.processed_at >= $3
                AND e.worker_release_sha = $4
              GROUP BY pr.type`,
            [tenant.tenantId, PRIVACY_TYPES, since, expectedRelease]
          )
        ]);

        const page = publication.rows[0];
        const privacyByType = Object.fromEntries(privacy.rows.map((row) => [row.type, {
          completedAt: iso(row.completed_at),
          count: Number(row.evidence_count) || 0,
          workerReleaseSha: row.worker_release_sha || null
        }]));

        return {
          publication: page ? {
            pageId: page.page_id,
            productId: page.shopify_product_id,
            jobId: page.job_id,
            publicUrl: page.public_url,
            contentHash: page.content_hash,
            changesPending: page.changes_pending === "true",
            lastJobError: page.last_job_error || null,
            completedAt: iso(page.completed_at),
            jobStatus: page.job_status,
            jobType: page.job_type,
            workerReleaseSha: page.worker_release_sha || null
          } : null,
          privacy: privacyByType
        };
      });
    }
  });
}

module.exports = { createShopifyCertificationRepository, PRIVACY_TYPES };
