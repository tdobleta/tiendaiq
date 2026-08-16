"use strict";

const crypto = require("crypto");

function contentHash(data) {
  return crypto.createHash("sha256").update(JSON.stringify(data || {})).digest("hex");
}

function createPublishPageHandler({ sessions, pages, publish, metrics }) {
  return Object.freeze({
    async run(job, { signal } = {}) {
      const pageId = String(job.payload?.pageId || "");
      if (!pageId) {
        const error = new Error("El job de publicación no tiene pageId");
        error.nonRetryable = true;
        throw error;
      }

      const page = await pages.get(job.tenant, pageId);
      if (!page) {
        const error = new Error("La página a publicar ya no existe");
        error.nonRetryable = true;
        throw error;
      }
      if (page.last_completed_job_id === job.id) {
        return { pageId, url: page.url_publica || null, replayed: true };
      }
      if (page.active_job_id !== job.id) {
        const error = new Error("El job de publicación ya no es el activo de la página");
        error.code = "PUBLISH_JOB_SUPERSEDED";
        error.nonRetryable = true;
        error.skipCompensation = true;
        throw error;
      }
      const session = await sessions.get(job.tenant);

      const wasPublished = job.payload?.previousState === "publicada";
      const publishedData = structuredClone(page.data);
      const originalAvatar = publishedData?.facetas?.hero?.resena_destacada?.avatar;
      const checkpointAvatar = async (avatarUrl, previousAvatar) => {
        await pages.checkpointAvatar(job.tenant, pageId, job.id, previousAvatar, avatarUrl);
      };
      const { url } = await publish(publishedData, session, undefined, {
        signal,
        onAvatarUploaded: checkpointAvatar
      });
      const publishedAvatar = publishedData?.facetas?.hero?.resena_destacada?.avatar;
      const publishedHash = contentHash(publishedData);

      const completion = await pages.completePublication(job.tenant, pageId, job.id, {
        url,
        originalAvatar,
        publishedAvatar,
        publishedHash
      });
      if (!completion) {
        const error = new Error("El job de publicacion perdio la propiedad de la pagina despues del efecto remoto");
        error.code = "PUBLISH_JOB_SUPERSEDED";
        error.nonRetryable = true;
        error.skipCompensation = true;
        throw error;
      }
      metrics("pagina_publicada", { tienda: job.tenantId, republicacion: wasPublished, job_id: job.id });
      return { pageId, url, replayed: completion.replayed === true };
    },

    needsCompensation(job, error) {
      return error?.skipCompensation !== true;
    },

    async onTerminalFailure(job, error, { signal } = {}) {
      const pageId = String(job.payload?.pageId || "");
      if (!pageId) return;
      if (signal?.aborted) throw signal.reason || new Error("Compensacion cancelada");
      await pages.markPublicationFailed(
        job.tenant,
        pageId,
        job.id,
        String(error?.message || error).slice(0, 500)
      );
    }
  });
}

module.exports = { createPublishPageHandler, contentHash };
