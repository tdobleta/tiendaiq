"use strict";

const crypto = require("crypto");

function contentHash(data) {
  return crypto.createHash("sha256").update(JSON.stringify(data || {})).digest("hex");
}

function createPublishPageHandler({ sessions, pages, publish, metrics }) {
  return Object.freeze({
    async run(job) {
      const pageId = String(job.payload?.pageId || "");
      if (!pageId) {
        const error = new Error("El job de publicación no tiene pageId");
        error.nonRetryable = true;
        throw error;
      }

      const session = await sessions.get(job.tenant);
      const page = await pages.get(job.tenant, pageId);
      if (!page) {
        const error = new Error("La página a publicar ya no existe");
        error.nonRetryable = true;
        throw error;
      }

      const wasPublished = page.estado === "publicada";
      const publishedData = structuredClone(page.data);
      const publishedHash = contentHash(publishedData);
      const { url } = await publish(publishedData, session);

      // Shopify es un sistema remoto: mientras responde, otro request puede
      // guardar cambios. Volvemos a leer y solo actualizamos metadatos para no
      // reemplazar esas ediciones con el snapshot anterior.
      const latest = await pages.get(job.tenant, pageId);
      if (!latest) return { pageId, url, pageDeleted: true };
      if (latest.active_job_id && latest.active_job_id !== job.id) {
        return { pageId, url, superseded: true };
      }
      latest.estado = "publicada";
      latest.url_publica = url;
      latest.active_job_id = null;
      latest.last_job_error = null;
      latest.published_content_hash = publishedHash;
      latest.cambios_sin_publicar = contentHash(latest.data) !== publishedHash;
      await pages.save(job.tenant, latest);
      metrics("pagina_publicada", { tienda: job.tenantId, republicacion: wasPublished, job_id: job.id });
      return { pageId, url };
    },

    async onTerminalFailure(job, error) {
      const pageId = String(job.payload?.pageId || "");
      if (!pageId) return;
      const page = await pages.get(job.tenant, pageId);
      if (!page || page.active_job_id !== job.id) return;
      page.estado = "necesita_atencion";
      page.active_job_id = null;
      page.last_job_error = String(error?.message || error).slice(0, 500);
      await pages.save(job.tenant, page);
    }
  });
}

module.exports = { createPublishPageHandler, contentHash };
