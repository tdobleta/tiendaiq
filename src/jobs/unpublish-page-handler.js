"use strict";

function createUnpublishPageHandler({ sessions, pages, unpublish, metrics }) {
  return Object.freeze({
    async run(job, { signal } = {}) {
      const pageId = String(job.payload?.pageId || "");
      if (!pageId) {
        const error = new Error("El job de despublicacion no tiene pageId");
        error.nonRetryable = true;
        throw error;
      }

      const page = await pages.get(job.tenant, pageId);
      if (!page) {
        const error = new Error("La pagina a despublicar ya no existe");
        error.nonRetryable = true;
        throw error;
      }
      if (page.last_completed_job_id === job.id) {
        return { pageId, replayed: true };
      }
      if (page.active_job_id !== job.id) {
        const error = new Error("El job de despublicacion ya no es el activo de la pagina");
        error.code = "UNPUBLISH_JOB_SUPERSEDED";
        error.nonRetryable = true;
        error.skipCompensation = true;
        throw error;
      }

      const session = await sessions.get(job.tenant);
      await unpublish(page.data, session, { signal });
      const completion = await pages.completeUnpublication(job.tenant, pageId, job.id);
      if (!completion) {
        const error = new Error("El job de despublicacion perdio la propiedad despues del efecto remoto");
        error.code = "UNPUBLISH_JOB_SUPERSEDED";
        error.nonRetryable = true;
        error.skipCompensation = true;
        throw error;
      }
      metrics("pagina_despublicada", { tienda: job.tenantId, job_id: job.id });
      return { pageId, replayed: completion.replayed === true };
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

module.exports = { createUnpublishPageHandler };
