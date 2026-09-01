"use strict";

function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new Error("Operación cancelada"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason || new Error("Operación cancelada"));
    }, { once: true });
  });
}

async function finalizeWithRetry(generations, tenant, value, { signal, retryMs = 250 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await generations.finalize(tenant, value);
    } catch (error) {
      lastError = error;
      if (error?.nonRetryable || attempt === 3 || signal?.aborted) break;
      await sleep(retryMs * attempt, signal);
    }
  }
  const ambiguous = new Error(
    "La IA respondió pero PostgreSQL no pudo confirmar el resultado; se requiere revisión manual",
    { cause: lastError }
  );
  ambiguous.code = "GENERATION_FINALIZE_AMBIGUOUS";
  ambiguous.nonRetryable = true;
  ambiguous.skipCompensation = true;
  throw ambiguous;
}

function pageIdFromProduct(productId) {
  return String(productId || "").split("/").pop();
}

function ambiguousProviderStateError(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = "GENERATION_PROVIDER_AMBIGUOUS";
  error.nonRetryable = true;
  error.skipCompensation = true;
  return error;
}

async function transitionProvider(generations, tenant, reservationId, command) {
  if (typeof generations.transitionProvider === "function") {
    return generations.transitionProvider(tenant, reservationId, command);
  }
  return generations.getReservation(tenant, reservationId, { providerTransition: command });
}

function providerOutcomeIsAmbiguous(error, signal) {
  return signal?.aborted === true
    || error?.code === "ANTHROPIC_AMBIGUOUS"
    || error?.code === "GENERATION_FINALIZE_AMBIGUOUS"
    || error?.code === "GENERATION_PROVIDER_AMBIGUOUS";
}

function createGeneratePageHandler({ sessions, generations, pages, generate, metrics, finalizeRetryMs = 250 }) {
  return Object.freeze({
    needsCompensation(job, error) {
      return Boolean(job.payload?.reservationId) && !error?.skipCompensation;
    },

    async run(job, { signal } = {}) {
      const { reservationId, productId, idioma = "es", angulo = "", estilo = "piloto-pdp-01" } = job.payload || {};
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

      if (["provider_in_flight", "ambiguous"].includes(reservation.providerState?.state)) {
        await transitionProvider(generations, job.tenant, reservationId, {
          action: "begin",
          jobId: job.id
        });
        throw ambiguousProviderStateError("La generación tiene un intento de proveedor sin resultado durable; requiere reconciliación manual");
      }

      const session = await sessions.get(job.tenant);
      const startedAt = Date.now();
      let providerAttempt = null;
      try {
        const { data, urls, avisos, uso } = await generate(productId, session, {
          idioma,
          angulo,
          estilo,
          signal,
          async beforeProviderCall() {
            providerAttempt = await transitionProvider(generations, job.tenant, reservationId, {
              action: "begin",
              jobId: job.id
            });
            if (!providerAttempt?.started) {
              throw ambiguousProviderStateError("Ya existe un intento de proveedor ambiguo; no se repetirá automáticamente");
            }
          }
        });
        if (!providerAttempt?.started) {
          throw ambiguousProviderStateError("El adaptador no confirmó el estado durable antes de llamar al proveedor");
        }
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
        await finalizeWithRetry(
          generations,
          job.tenant,
          { reservationId, pageId, page },
          { signal, retryMs: finalizeRetryMs }
        );
        metrics("pagina_generada", { tienda: job.tenantId, job_id: job.id, segundos: (Date.now() - startedAt) / 1000 });
        return { pageId, segundos: (Date.now() - startedAt) / 1000, uso };
      } catch (error) {
        if (providerAttempt?.attemptId) {
          const action = providerOutcomeIsAmbiguous(error, signal) ? "ambiguous" : "clear";
          try {
            await transitionProvider(generations, job.tenant, reservationId, {
              action,
              jobId: job.id,
              attemptId: providerAttempt.attemptId,
              error
            });
          } catch (stateError) {
            error.providerStateError = stateError;
          }
        }
        if (providerOutcomeIsAmbiguous(error, signal)) {
          error.nonRetryable = true;
          error.skipCompensation = true;
        }
        throw error;
      }
    },

    async onTerminalFailure(job, error, { signal } = {}) {
      const reservationId = job.payload?.reservationId;
      if (signal?.aborted) throw signal.reason || new Error("Compensacion cancelada");
      if (error?.skipCompensation) return;
      if (reservationId) await generations.release(job.tenant, reservationId, error);
    }
  });
}

module.exports = {
  ambiguousProviderStateError,
  createGeneratePageHandler,
  finalizeWithRetry,
  pageIdFromProduct,
  providerOutcomeIsAmbiguous,
  transitionProvider
};
