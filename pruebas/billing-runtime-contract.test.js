"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  billingRuntimeContract,
  billingRuntimeCompatible
} = require("../src/runtime/billing-runtime-contract");
const { montar } = require("./dobles");

test("el contrato de billing normaliza solo señales no secretas", () => {
  assert.deepEqual(billingRuntimeContract({ PLAN_TEST: "1", SHOPIFY_APP_HANDLE: " TiendaIQ-Staging " }), {
    version: 1,
    planTest: true,
    appHandle: "tiendaiq-staging"
  });
  assert.deepEqual(billingRuntimeContract({ PLAN_TEST: "true", SHOPIFY_APP_HANDLE: "invalido/con-barra" }), {
    version: 1,
    planTest: false,
    appHandle: null
  });
});

test("billing solo es compatible con todos los workers activos y la misma configuración", () => {
  const expected = billingRuntimeContract({ PLAN_TEST: "1", SHOPIFY_APP_HANDLE: "tiendaiq-staging" });
  const observed = {
    version: 1,
    planTest: true,
    appHandle: "tiendaiq-staging",
    configured: true,
    activeWorkers: 1,
    versionVariants: 1,
    planTestVariants: 1,
    appHandleVariants: 1
  };
  assert.equal(billingRuntimeCompatible(expected, observed), true);
  assert.equal(billingRuntimeCompatible(expected, { ...observed, planTest: false }), false);
  assert.equal(billingRuntimeCompatible(expected, { ...observed, appHandle: null, configured: false }), false);
  assert.equal(billingRuntimeCompatible(expected, { ...observed, activeWorkers: 2, appHandleVariants: 2 }), false);
});

test("un handle ausente no se confunde con una mutación Shopify ambigua", async () => {
  const { modulo, shopify } = montar("facturacion.js", {
    env: { PLAN_TEST: "1", SHOPIFY_APP_HANDLE: "" }
  });
  await assert.rejects(
    () => modulo.iniciarSuscripcion({ tienda: "billing.myshopify.com", token: "token" }, "https://tiendaiq.example"),
    (error) => error?.code === "BILLING_RUNTIME_CONFIG_INVALID" && error?.nonRetryable === true
  );
  assert.equal(shopify.llamadas.length, 1, "solo consulta el estado antes de rechazar la configuración");
  assert.doesNotMatch(shopify.llamadas[0].query, /appSubscriptionCreate/);
});
