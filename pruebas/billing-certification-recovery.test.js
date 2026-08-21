"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { montar } = require("./dobles");
const { isNonRetryable } = require("../src/jobs/job-runner");
const {
  createSubscriptionRecoveryDiagnostic,
  subscriptionRecoveryDiagnosticFromJob
} = require("../src/jobs/subscription-recovery");
const { failureResult } = require("../src/platform/postgres/job-repository");
const { certificationConfigurationDiagnostic } = require("../src/shopify/certification-diagnostic");
const { certificationFailureSummary } = require("../scripts/verificar-certificacion-shopify-staging");

const SESSION = { tienda: "recovery.myshopify.com", token: "token-falso" };
const NONE = { currentAppInstallation: { activeSubscriptions: [] } };

test("PAGINAS_GRATIS acepta cero y sólo usa 3 ante ausencia, vacío o inválido", () => {
  const value = (raw) => montar("facturacion.js", { env: raw === undefined ? {} : { PAGINAS_GRATIS: raw } }).modulo.PAGINAS_GRATIS;
  assert.equal(value("0"), 0);
  assert.equal(value(undefined), 3);
  assert.equal(value(""), 3);
  assert.equal(value("  "), 3);
  assert.equal(value("-1"), 3);
  assert.equal(value("1.5"), 3);
  assert.equal(value("no-numero"), 3);
});

test("una respuesta Shopify sin confirmationUrl persiste sólo diagnóstico seguro", async () => {
  const { modulo, shopify } = montar("facturacion.js", {
    respuestas: [
      NONE,
      { appSubscriptionCreate: { appSubscription: { id: "gid://shopify/AppSubscription/secret-id", status: "PENDING" }, confirmationUrl: null, userErrors: [] } },
      NONE
    ]
  });

  await assert.rejects(
    () => modulo.iniciarSuscripcion(SESSION, "https://tiendaiq.example"),
    (error) => {
      assert.equal(error.code, "SHOPIFY_SUBSCRIPTION_AMBIGUOUS");
      assert.deepEqual(error.safeDiagnostic, {
        kind: "shopify_subscription_recovery",
        version: 1,
        mutationAttempted: true,
        mutationResponseReceived: true,
        confirmationUrlPresent: false,
        subscriptionIdPresent: true,
        subscriptionStatus: "PENDING",
        activeSubscriptionFound: false,
        reconciliationAttempted: true,
        reconciliationFailed: false,
        requiresManualReview: true
      });
      assert.doesNotMatch(JSON.stringify(error.safeDiagnostic), /secret-id|shopify\.example/);
      return true;
    }
  );
  assert.equal(shopify.llamadas.filter((call) => /appSubscriptionCreate/.test(call.query)).length, 1);
});

test("el job ambiguo recibe una única reconciliación segura antes de quedar bloqueado", () => {
  const error = Object.assign(new Error("ambiguous"), {
    code: "SHOPIFY_SUBSCRIPTION_AMBIGUOUS",
    nonRetryable: true,
    safeDiagnostic: createSubscriptionRecoveryDiagnostic({ mutationAttempted: true })
  });
  assert.equal(isNonRetryable(error), false);

  const persisted = failureResult(error);
  assert.deepEqual(persisted, { diagnostic: error.safeDiagnostic });
  assert.deepEqual(subscriptionRecoveryDiagnosticFromJob({ status: "failed", result: persisted }), error.safeDiagnostic);
});

test("la compatibilidad detecta el fallo ambiguo histórico y no expone su mensaje", () => {
  const diagnostic = subscriptionRecoveryDiagnosticFromJob({
    status: "failed",
    lastError: "Shopify pudo haber creado la suscripción, pero no confirmó el resultado; se requiere reconciliación antes de volver a intentar"
  });
  assert.equal(diagnostic.kind, "shopify_subscription_recovery");
  assert.equal(diagnostic.confirmationUrlPresent, false);
  assert.equal(diagnostic.subscriptionIdPresent, false);
});

test("el 503 de certificación sólo enumera configuración ausente, nunca valores", () => {
  const diagnostic = certificationConfigurationDiagnostic({
    shop: "",
    pageId: "",
    planTest: false,
    releaseSha: "not-a-sha"
  });
  assert.deepEqual(diagnostic.missingConfiguration, [
    "SHOPIFY_CERTIFICATION_SHOP",
    "SHOPIFY_CERTIFICATION_PAGE_ID",
    "PLAN_TEST",
    "RENDER_GIT_COMMIT"
  ]);
  const summary = certificationFailureSummary({
    error: "certification_not_configured",
    diagnostic: { missingConfiguration: [...diagnostic.missingConfiguration, "TOKEN_ENC_KEY"] },
    errors: ["billing_not_active", "valor inesperado", "secret value"]
  });
  assert.deepEqual(summary, {
    error: "certification_not_configured",
    missingConfiguration: diagnostic.missingConfiguration,
    errors: ["billing_not_active"]
  });
});
