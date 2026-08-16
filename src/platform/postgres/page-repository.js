"use strict";

const crypto = require("crypto");
const { requireTenantContext } = require("../../tenancy/tenant-context");
const { withTenantTransaction } = require("./with-tenant-transaction");
const { mapJob } = require("./job-repository");

function mapPageSummary(row) {
  return {
    id: row.id,
    shopify_product_id: row.shopify_product_id || null,
    estado: row.estado,
    url_publica: row.url_publica || null,
    actualizado: row.actualizado || null,
    titulo: row.titulo || null,
    imagen: row.imagen || null
  };
}

function createPageRepository(pool) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("Se requiere un pool de Postgres");

  async function enqueueOperation(context, id, { type, state, maxAttempts = 3 }) {
    const tenant = requireTenantContext(context);
    return withTenantTransaction(pool, tenant, async (client) => {
      const locked = await client.query(
        "SELECT datos FROM public.paginas WHERE tienda = $1 AND id = $2 FOR UPDATE",
        [tenant.tenantId, id]
      );
      let page = locked.rows[0]?.datos ?? null;
      if (!page) return null;

      if (page.active_job_id) {
        const active = await client.query(
          "SELECT * FROM control_plane.jobs WHERE tenant_id = $1 AND id = $2",
          [tenant.tenantId, page.active_job_id]
        );
        const currentJob = mapJob(active.rows[0]);
        if (currentJob && ["queued", "running"].includes(currentJob.status)) {
          if (currentJob.type === type) return { page, job: currentJob, reused: true, conflict: false };
          return { page, job: currentJob, reused: false, conflict: true };
        }

        page = {
          ...page,
          estado: currentJob?.status === "failed" ? "necesita_atencion" : page.estado,
          active_job_id: null,
          last_job_error: currentJob?.status === "failed"
            ? String(currentJob.lastError || "La operacion anterior no pudo completarse").slice(0, 500)
            : page.last_job_error
        };
      }

      const jobId = crypto.randomUUID();
      const jobResult = await client.query(
        `INSERT INTO control_plane.jobs
           (id, tenant_id, type, payload, status, attempts, max_attempts, run_after, idempotency_key)
         VALUES ($1, $2, $3, $4, 'queued', 0, $5, now(), $6)
         RETURNING *`,
        [
          jobId,
          tenant.tenantId,
          type,
          { pageId: id, previousState: page.estado },
          Math.max(1, Number(maxAttempts) || 3),
          `${type}:${id}:${jobId}`
        ]
      );
      const updatedPage = {
        ...page,
        estado: state,
        active_job_id: jobId,
        last_job_error: null
      };
      await client.query(
        `UPDATE public.paginas
            SET datos = $3, actualizada = now()
          WHERE tienda = $1 AND id = $2`,
        [tenant.tenantId, id, updatedPage]
      );
      return { page: updatedPage, job: mapJob(jobResult.rows[0]), reused: false, conflict: false };
    });
  }

  async function mutateOwnedPage(context, id, activeJobId, mutate) {
    const tenant = requireTenantContext(context);
    return withTenantTransaction(pool, tenant, async (client) => {
      const locked = await client.query(
        "SELECT datos FROM public.paginas WHERE tienda = $1 AND id = $2 FOR UPDATE",
        [tenant.tenantId, id]
      );
      const page = locked.rows[0]?.datos ?? null;
      if (!page) return null;
      if (page.last_completed_job_id === activeJobId) return { page, replayed: true };
      if (page.active_job_id !== activeJobId) return null;
      const updated = await mutate(structuredClone(page));
      if (!updated) return { page, skipped: true };
      await client.query(
        `UPDATE public.paginas
            SET datos = $3, actualizada = now()
          WHERE tienda = $1 AND id = $2
            AND datos->>'active_job_id' = $4`,
        [tenant.tenantId, id, updated, activeJobId]
      );
      return { page: updated, replayed: false };
    });
  }

  return Object.freeze({
    async save(context, id, data) {
      const tenant = requireTenantContext(context);
      await withTenantTransaction(pool, tenant, (client) => client.query(
        `INSERT INTO public.paginas (tienda, id, datos, actualizada) VALUES ($1, $2, $3, now())
         ON CONFLICT (tienda, id) DO UPDATE SET datos = $3, actualizada = now()`,
        [tenant.tenantId, id, data]
      ));
    },

    async findById(context, id) {
      const tenant = requireTenantContext(context);
      const result = await withTenantTransaction(pool, tenant, (client) => client.query(
        "SELECT datos FROM public.paginas WHERE tienda = $1 AND id = $2",
        [tenant.tenantId, id]
      ));
      return result.rows[0]?.datos ?? null;
    },

    async enqueuePublication(context, id, { maxAttempts = 3 } = {}) {
      return enqueueOperation(context, id, {
        type: "publish-page",
        state: "publicando",
        maxAttempts
      });
    },

    async enqueueUnpublication(context, id, { maxAttempts = 3 } = {}) {
      return enqueueOperation(context, id, {
        type: "unpublish-page",
        state: "despublicando",
        maxAttempts
      });
    },

    async checkpointPublicationAvatar(context, id, activeJobId, previousAvatar, uploadedAvatar) {
      return mutateOwnedPage(context, id, activeJobId, (page) => {
        const review = page.data?.facetas?.hero?.resena_destacada;
        if (!review || review.avatar !== previousAvatar) return null;
        review.avatar = uploadedAvatar;
        return page;
      });
    },

    async completePublication(context, id, activeJobId, { url, originalAvatar, publishedAvatar, publishedHash }) {
      return mutateOwnedPage(context, id, activeJobId, (page) => {
        const review = page.data?.facetas?.hero?.resena_destacada;
        if (review && publishedAvatar !== originalAvatar && review.avatar === originalAvatar) {
          review.avatar = publishedAvatar;
        }
        page.estado = "publicada";
        page.url_publica = url;
        page.active_job_id = null;
        page.last_completed_job_id = activeJobId;
        page.last_job_error = null;
        page.published_content_hash = publishedHash;
        const currentHash = crypto.createHash("sha256").update(JSON.stringify(page.data || {})).digest("hex");
        page.cambios_sin_publicar = currentHash !== publishedHash;
        return page;
      });
    },

    async completeUnpublication(context, id, activeJobId) {
      return mutateOwnedPage(context, id, activeJobId, (page) => {
        page.estado = "borrador";
        page.url_publica = null;
        page.active_job_id = null;
        page.last_completed_job_id = activeJobId;
        page.last_job_error = null;
        return page;
      });
    },

    async markPublicationFailed(context, id, activeJobId, errorMessage) {
      const tenant = requireTenantContext(context);
      const result = await withTenantTransaction(pool, tenant, (client) => client.query(
        `UPDATE public.paginas
            SET datos = jsonb_set(
                  jsonb_set(
                    jsonb_set(datos, '{estado}', to_jsonb('necesita_atencion'::text), true),
                    '{active_job_id}', 'null'::jsonb, true
                  ),
                  '{last_job_error}', to_jsonb($4::text), true
                ),
                actualizada = now()
          WHERE tienda = $1 AND id = $2
            AND datos->>'active_job_id' = $3
          RETURNING datos`,
        [tenant.tenantId, id, activeJobId, String(errorMessage || "Fallo terminal").slice(0, 500)]
      ));
      return result.rows[0]?.datos ?? null;
    },

    async list(context) {
      const tenant = requireTenantContext(context);
      const result = await withTenantTransaction(pool, tenant, (client) => client.query(
        `SELECT
           datos->>'id'                         AS id,
           datos->>'shopify_product_id'         AS shopify_product_id,
           datos->>'estado'                     AS estado,
           datos->>'url_publica'                AS url_publica,
           datos->>'actualizado'                AS actualizado,
           datos#>>'{data,facetas,hero,titulo}' AS titulo,
           (datos->'urls') ->> (datos#>>'{data,facetas,hero,galeria,0}') AS imagen
         FROM public.paginas
         WHERE tienda = $1
         ORDER BY actualizada DESC`,
        [tenant.tenantId]
      ));
      return result.rows.map(mapPageSummary);
    }
  });
}

module.exports = { createPageRepository, mapPageSummary };
