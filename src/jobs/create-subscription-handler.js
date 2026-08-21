"use strict";

const { createSubscriptionRecoveryDiagnostic } = require("./subscription-recovery");

function terminalError(message, code, safeDiagnostic = null) {
  const error = new Error(message);
  error.code = code;
  error.nonRetryable = true;
  if (safeDiagnostic) error.safeDiagnostic = safeDiagnostic;
  return error;
}

function assertSerializableResult(result) {
  if (!result || !["active", "pending_confirmation"].includes(result.status)) {
    throw terminalError("Facturación devolvió un resultado inválido", "SUBSCRIPTION_RESULT_INVALID");
  }
  if (result.status === "pending_confirmation" && !result.confirmationUrl) {
    throw terminalError("Shopify no devolvió la URL de confirmación", "SUBSCRIPTION_RESULT_INVALID");
  }
  try {
    return JSON.parse(JSON.stringify(result));
  } catch (cause) {
    const error = terminalError("Facturación devolvió un resultado no serializable", "SUBSCRIPTION_RESULT_INVALID");
    error.cause = cause;
    throw error;
  }
}

function createCreateSubscriptionHandler({ sessions, billing, metrics = () => {} }) {
  if (typeof sessions?.get !== "function") {
    throw new TypeError("El handler de suscripción requiere sessions.get");
  }
  if (typeof billing?.iniciarSuscripcion !== "function" ||
      typeof billing?.reconciliarSuscripcionActiva !== "function") {
    throw new TypeError("El handler de suscripción requiere el núcleo durable de facturación");
  }

  return Object.freeze({
    needsCompensation() {
      return false;
    },

    async run(job, { signal } = {}) {
      const urlApp = String(job.payload?.urlApp || "").trim();
      if (!urlApp) {
        throw terminalError("El job de suscripción no tiene urlApp", "SUBSCRIPTION_JOB_INCOMPLETE");
      }

      const session = await sessions.get(job.tenant);
      let result;
      // Shopify no admite idempotency key para appSubscriptionCreate. Si este
      // job ya fue reclamado una vez, el intento anterior pudo alcanzar al
      // proveedor aunque no haya respuesta durable: desde aquí sólo se lee.
      const reconcileOnly = job.payload?.reconcileOnly === true || Number(job.attempts || 0) > 1;
      if (reconcileOnly) {
        result = await billing.reconciliarSuscripcionActiva(session, {
          signal,
          reconciled: true
        });
        if (!result) {
          const error = terminalError(
            "Shopify todavía no informa una suscripción activa; no se creará otro cargo automáticamente",
            "SUBSCRIPTION_RECONCILIATION_PENDING",
            createSubscriptionRecoveryDiagnostic({
              reconciliationAttempted: true,
              activeSubscriptionFound: false
            })
          );
          error.ambiguous = true;
          error.skipCompensation = true;
          throw error;
        }
      } else {
        result = await billing.iniciarSuscripcion(session, urlApp, { signal });
      }

      const serializable = assertSerializableResult(result);
      metrics("suscripcion_job_resuelta", {
        tienda: job.tenantId,
        job_id: job.id,
        estado: serializable.status,
        reconciliada: serializable.reconciled === true
      });
      return serializable;
    }
  });
}

module.exports = {
  assertSerializableResult,
  createCreateSubscriptionHandler,
  terminalError
};
