"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertSerializableResult,
  createCreateSubscriptionHandler
} = require("../src/jobs/create-subscription-handler");

const JOB = {
  id: "job-sub-1",
  tenant: "tenant_schema",
  tenantId: "prueba.myshopify.com",
  payload: { urlApp: "https://tiendaiq.example" }
};
const SESSION = { tienda: "prueba.myshopify.com", token: "token" };

function dependencies(overrides = {}) {
  return {
    sessions: { async get() { return SESSION; } },
    billing: {
      async iniciarSuscripcion() {
        return {
          status: "pending_confirmation",
          alreadyActive: false,
          reconciled: false,
          confirmationUrl: "https://shopify.example/confirm",
          subscription: { id: "sub-1" }
        };
      },
      async reconciliarSuscripcionActiva() { return null; }
    },
    ...overrides
  };
}

test("el handler devuelve el resultado durable y serializable", async () => {
  const events = [];
  const handler = createCreateSubscriptionHandler(dependencies({
    metrics(name, data) { events.push({ name, data }); }
  }));

  const result = await handler.run(JOB);

  assert.equal(result.status, "pending_confirmation");
  assert.equal(result.confirmationUrl, "https://shopify.example/confirm");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.equal(events[0].data.job_id, JOB.id);
  assert.equal(handler.needsCompensation(JOB, new Error("x")), false);
});

test("reconcileOnly consulta sin volver a crear una suscripción", async () => {
  let starts = 0;
  const handler = createCreateSubscriptionHandler(dependencies({
    billing: {
      async iniciarSuscripcion() { starts += 1; },
      async reconciliarSuscripcionActiva() {
        return {
          status: "active",
          alreadyActive: true,
          reconciled: true,
          confirmationUrl: null,
          subscription: { id: "sub-activa" }
        };
      }
    }
  }));

  const result = await handler.run({
    ...JOB,
    payload: { ...JOB.payload, reconcileOnly: true }
  });

  assert.equal(result.status, "active");
  assert.equal(result.reconciled, true);
  assert.equal(starts, 0);
});

test("reconcileOnly sin evidencia activa queda terminal y no crea cargos", async () => {
  let starts = 0;
  const handler = createCreateSubscriptionHandler(dependencies({
    billing: {
      async iniciarSuscripcion() { starts += 1; },
      async reconciliarSuscripcionActiva() { return null; }
    }
  }));

  await assert.rejects(
    () => handler.run({ ...JOB, payload: { ...JOB.payload, reconcileOnly: true } }),
    (error) => error.code === "SUBSCRIPTION_RECONCILIATION_PENDING"
      && error.nonRetryable === true
      && error.ambiguous === true
  );
  assert.equal(starts, 0);
});

test("un job reclamado por segunda vez sólo reconcilia y nunca repite el cargo", async () => {
  let starts = 0;
  let reconciliations = 0;
  const handler = createCreateSubscriptionHandler(dependencies({
    billing: {
      async iniciarSuscripcion() { starts += 1; },
      async reconciliarSuscripcionActiva() {
        reconciliations += 1;
        return null;
      }
    }
  }));

  await assert.rejects(
    () => handler.run({ ...JOB, attempts: 2 }),
    (error) => error.code === "SUBSCRIPTION_RECONCILIATION_PENDING" && error.nonRetryable === true
  );
  assert.equal(reconciliations, 1);
  assert.equal(starts, 0);
});

test("rechaza jobs incompletos antes de resolver la sesión", async () => {
  let sessionReads = 0;
  const deps = dependencies();
  deps.sessions.get = async () => { sessionReads += 1; return SESSION; };
  const handler = createCreateSubscriptionHandler(deps);

  await assert.rejects(
    () => handler.run({ ...JOB, payload: {} }),
    (error) => error.code === "SUBSCRIPTION_JOB_INCOMPLETE" && error.nonRetryable === true
  );
  assert.equal(sessionReads, 0);
});

test("rechaza resultados que no permiten decidir el siguiente paso", () => {
  assert.throws(
    () => assertSerializableResult({ status: "pending_confirmation", confirmationUrl: null }),
    (error) => error.code === "SUBSCRIPTION_RESULT_INVALID" && error.nonRetryable === true
  );
});

test("rechaza como terminal un resultado que PostgreSQL no podría serializar", () => {
  assert.throws(
    () => assertSerializableResult({ status: "active", confirmationUrl: null, unsafe: 1n }),
    (error) => error.code === "SUBSCRIPTION_RESULT_INVALID"
      && error.nonRetryable === true
      && error.cause instanceof TypeError
  );
});
