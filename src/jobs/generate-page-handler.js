"use strict";

function pageIdFromProduct(productId) {
  return String(productId || "").split("/").pop();
}

function createGeneratePageHandler({ sessions, generations, pages, generate, metrics }) {
  return Object.freeze({
    compensateBeforeTerminal: true,

    async run(job) {
      const { reservationId, productId, idioma = "es", angulo = "", estilo = "clasico" } = job.payload || {};
      const pageId = pageIdFromProduct(productId);
      if (!reservationId || !pageId) {
        const error = new Error("El job de generación está incompleto");
        error.nonRetryable = true;
        throw error;
      }

      const reservation = await generations.getReservation(job.tenant, reservationId);
      if (!reservation) {
        const error = new Error("La reserva de generación no existe");
        error.nonRetryable = true;
        throw error;
      }
      if (reservation.status === "committed") {
        const existing = await pages.get(job.tenant, pageId);
        if (!existing) {
          const error = new Error("La reserva está confirmada pero la página no existe");
          error.nonRetryable = true;
          throw error;
        }
        return { pageId, recovered: true };
      }
      if (reservation.status === "released") {
        const error = new Error("La reserva de generación fue liberada");
        error.nonRetryable = true;
        throw error;
      }

      const session = await sessions.get(job.tenant);
      const startedAt = Date.now();
      const { data, urls, avisos, uso } = await generate(productId, session, { idioma, angulo, estilo });
      const page = {
        id: pageId,
        shopify_product_id: productId,
        estado: "borrador",
        data,
        urls,
        avisos,
        url_publica: null,
        actualizado: new Date().toISOString()
      };
      await generations.finalize(job.tenant, { reservationId, pageId, page });
      metrics("pagina_generada", { tienda: job.tenantId, job_id: job.id, segundos: (Date.now() - startedAt) / 1000 });
      return { pageId, segundos: (Date.now() - startedAt) / 1000, uso };
    },

    async onTerminalFailure(job, error) {
      const reservationId = job.payload?.reservationId;
      if (reservationId) await generations.release(job.tenant, reservationId, error);
    }
  });
}

module.exports = { createGeneratePageHandler, pageIdFromProduct };
