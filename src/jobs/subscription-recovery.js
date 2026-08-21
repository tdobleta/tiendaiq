"use strict";

const SUBSCRIPTION_RECOVERY_DIAGNOSTIC_KIND = "shopify_subscription_recovery";
const SUBSCRIPTION_RECOVERY_DIAGNOSTIC_VERSION = 1;
const LEGACY_AMBIGUOUS_SUBSCRIPTION_MESSAGE = "Shopify pudo haber creado la suscripción, pero no confirmó el resultado";
const SAFE_STATUSES = new Set(["ACTIVE", "PENDING", "DECLINED", "CANCELLED", "FROZEN", "EXPIRED"]);

function safeStatus(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return SAFE_STATUSES.has(normalized) ? normalized : null;
}

// Este contrato es deliberadamente pobre: permite operar la recuperación sin
// guardar confirmationUrl, tokens ni IDs de Shopify en errores o logs.
function createSubscriptionRecoveryDiagnostic({
  mutationAttempted = false,
  mutationResponseReceived = false,
  confirmationUrlPresent = false,
  subscriptionIdPresent = false,
  subscriptionStatus = null,
  activeSubscriptionFound = false,
  reconciliationAttempted = false,
  reconciliationFailed = false
} = {}) {
  return Object.freeze({
    kind: SUBSCRIPTION_RECOVERY_DIAGNOSTIC_KIND,
    version: SUBSCRIPTION_RECOVERY_DIAGNOSTIC_VERSION,
    mutationAttempted: mutationAttempted === true,
    mutationResponseReceived: mutationResponseReceived === true,
    confirmationUrlPresent: confirmationUrlPresent === true,
    subscriptionIdPresent: subscriptionIdPresent === true,
    subscriptionStatus: safeStatus(subscriptionStatus),
    activeSubscriptionFound: activeSubscriptionFound === true,
    reconciliationAttempted: reconciliationAttempted === true,
    reconciliationFailed: reconciliationFailed === true,
    requiresManualReview: true
  });
}

function safeSubscriptionRecoveryDiagnostic(value) {
  if (!value || value.kind !== SUBSCRIPTION_RECOVERY_DIAGNOSTIC_KIND ||
      Number(value.version) !== SUBSCRIPTION_RECOVERY_DIAGNOSTIC_VERSION) {
    return null;
  }
  return createSubscriptionRecoveryDiagnostic(value);
}

function subscriptionRecoveryDiagnosticFromJob(job) {
  const persisted = safeSubscriptionRecoveryDiagnostic(job?.result?.diagnostic);
  if (persisted) return persisted;
  // Jobs creados antes del contrato versionado sólo guardaron el mensaje. Se
  // reconocen para impedir que una recuperación posterior cree otro cargo.
  if (job?.status === "failed" && String(job?.lastError || "").startsWith(LEGACY_AMBIGUOUS_SUBSCRIPTION_MESSAGE)) {
    return createSubscriptionRecoveryDiagnostic({ mutationAttempted: true });
  }
  return null;
}

module.exports = {
  SUBSCRIPTION_RECOVERY_DIAGNOSTIC_KIND,
  createSubscriptionRecoveryDiagnostic,
  safeSubscriptionRecoveryDiagnostic,
  subscriptionRecoveryDiagnosticFromJob
};
