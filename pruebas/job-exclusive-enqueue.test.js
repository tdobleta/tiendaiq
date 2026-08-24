"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TenantContext } = require("../src/tenancy/tenant-context");
const { createJobRepository } = require("../src/platform/postgres/job-repository");

const tenant = TenantContext.fromShopDomain("exclusive.myshopify.com", { source: "internal-job" });

test("el encolado exclusivo reutiliza el job activo bajo un bloqueo de la tienda", async () => {
  const queries = [];
  const active = {
    id: "11111111-1111-4111-8111-111111111111",
    tenant_id: tenant.tenantId,
    type: "install-niche-content",
    payload: {},
    status: "running",
    attempts: 1,
    max_attempts: 5,
    idempotency_key: "install-niche-content:old-request"
  };
  const client = {
    async query(text, values) {
      queries.push({ text, values });
      if (/SELECT dominio FROM public\.tiendas/.test(text)) return { rows: [{ dominio: tenant.tenantId }] };
      if (/FROM control_plane\.jobs/.test(text) && /status IN \('queued', 'running'\)/.test(text)) return { rows: [active] };
      return { rows: [] };
    },
    release() {}
  };
  const repository = createJobRepository({ async connect() { return client; } });

  const result = await repository.enqueueExclusive(tenant, {
    type: "install-niche-content",
    idempotencyKey: "install-niche-content:new-request"
  });

  assert.equal(result.id, active.id);
  assert.equal(result.status, "running");
  assert.ok(queries.some(({ text }) => /public\.tiendas WHERE dominio = \$1 FOR UPDATE/.test(text)));
  assert.ok(queries.some(({ text }) => /status IN \('queued', 'running'\)/.test(text)));
  assert.equal(queries.some(({ text }) => /INSERT INTO control_plane\.jobs/.test(text)), false);
});

test("el encolado exclusivo crea el job solo despues de comprobar que no hay otro activo", async () => {
  const queries = [];
  const inserted = {
    id: "22222222-2222-4222-8222-222222222222",
    tenant_id: tenant.tenantId,
    type: "install-niche-content",
    payload: {},
    status: "queued",
    attempts: 0,
    max_attempts: 5,
    idempotency_key: "install-niche-content:new-request"
  };
  const client = {
    async query(text, values) {
      queries.push({ text, values });
      if (/SELECT dominio FROM public\.tiendas/.test(text)) return { rows: [{ dominio: tenant.tenantId }] };
      if (/FROM control_plane\.jobs/.test(text) && /status IN \('queued', 'running'\)/.test(text)) return { rows: [] };
      if (/INSERT INTO control_plane\.jobs/.test(text)) return { rows: [inserted] };
      return { rows: [] };
    },
    release() {}
  };
  const repository = createJobRepository({ async connect() { return client; } });

  const result = await repository.enqueueExclusive(tenant, {
    type: "install-niche-content",
    idempotencyKey: "install-niche-content:new-request"
  });

  assert.equal(result.id, inserted.id);
  assert.equal(result.status, "queued");
  const insertion = queries.find(({ text }) => /INSERT INTO control_plane\.jobs/.test(text));
  assert.deepEqual(insertion.values.slice(1, 3), [tenant.tenantId, "install-niche-content"]);
});

test("el encolado exclusivo conserva la idempotencia despues de que el job termina", async () => {
  const completed = {
    id: "33333333-3333-4333-8333-333333333333",
    tenant_id: tenant.tenantId,
    type: "install-niche-content",
    payload: {},
    status: "succeeded",
    attempts: 1,
    max_attempts: 5,
    idempotency_key: "install-niche-content:replayed-request"
  };
  const client = {
    async query(text) {
      if (/SELECT dominio FROM public\.tiendas/.test(text)) return { rows: [{ dominio: tenant.tenantId }] };
      if (/FROM control_plane\.jobs/.test(text) && /status IN \('queued', 'running'\)/.test(text)) return { rows: [] };
      if (/WITH inserted AS/.test(text)) return { rows: [completed] };
      return { rows: [] };
    },
    release() {}
  };
  const repository = createJobRepository({ async connect() { return client; } });

  const result = await repository.enqueueExclusive(tenant, {
    type: "install-niche-content",
    idempotencyKey: completed.idempotency_key
  });

  assert.equal(result.id, completed.id);
  assert.equal(result.status, "succeeded");
});

test("la exclusión se aplica también a la intención de cobro Shopify", async () => {
  const active = {
    id: "44444444-4444-4444-8444-444444444444",
    tenant_id: tenant.tenantId,
    type: "create-subscription",
    payload: { urlApp: "https://tiendaiq.example" },
    status: "running",
    attempts: 1,
    max_attempts: 2,
    idempotency_key: "create-subscription:first-request"
  };
  const client = {
    async query(text) {
      if (/SELECT dominio FROM public\.tiendas/.test(text)) return { rows: [{ dominio: tenant.tenantId }] };
      if (/FROM control_plane\.jobs/.test(text) && /status IN \('queued', 'running'\)/.test(text)) return { rows: [active] };
      return { rows: [] };
    },
    release() {}
  };
  const repository = createJobRepository({ async connect() { return client; } });

  const result = await repository.enqueueExclusive(tenant, {
    type: "create-subscription",
    payload: active.payload,
    idempotencyKey: "create-subscription:second-request",
    maxAttempts: 2
  });

  assert.equal(result.id, active.id);
  assert.equal(result.type, "create-subscription");
});

test("una suscripción ambigua terminal bloquea una nueva mutación de billing", async () => {
  const blocked = {
    id: "55555555-5555-4555-8555-555555555555",
    tenant_id: tenant.tenantId,
    type: "create-subscription",
    payload: {},
    status: "failed",
    attempts: 2,
    max_attempts: 2,
    last_error: "Shopify pudo haber creado la suscripción, pero no confirmó el resultado; se requiere reconciliación antes de volver a intentar",
    result: { diagnostic: { kind: "shopify_subscription_recovery", version: 1 } }
  };
  const queries = [];
  const client = {
    async query(text) {
      queries.push(text);
      if (/SELECT dominio FROM public\.tiendas/.test(text)) return { rows: [{ dominio: tenant.tenantId }] };
      if (/status IN \('queued', 'running'\)/.test(text)) return { rows: [] };
      if (/status = 'failed'/.test(text) && /result->'diagnostic'/.test(text)) return { rows: [blocked] };
      if (/INSERT INTO control_plane\.jobs/.test(text)) throw new Error("no debe crear un segundo cargo");
      return { rows: [] };
    },
    release() {}
  };
  const repository = createJobRepository({ async connect() { return client; } });

  const result = await repository.enqueueExclusive(tenant, {
    type: "create-subscription",
    payload: { urlApp: "https://tiendaiq.example" },
    idempotencyKey: "create-subscription:new-request",
    maxAttempts: 2
  });

  assert.equal(result.id, blocked.id);
  assert.equal(result.status, "failed");
  assert.equal(queries.some((query) => /last_error LIKE/.test(query)), true);
});

test("una intención explícita puede pasar a reconciliación luego de un fallo ambiguo", async () => {
  const blocked = {
    id: "66666666-6666-4666-8666-666666666666",
    tenant_id: tenant.tenantId,
    type: "create-subscription",
    payload: {},
    status: "failed",
    attempts: 2,
    max_attempts: 2,
    last_error: "Shopify pudo haber creado la suscripción, pero no confirmó el resultado",
    result: { diagnostic: { kind: "shopify_subscription_recovery", version: 1 } }
  };
  const inserted = {
    id: "77777777-7777-4777-8777-777777777777",
    tenant_id: tenant.tenantId,
    type: "create-subscription",
    payload: { urlApp: "https://tiendaiq.example" },
    status: "queued",
    attempts: 0,
    max_attempts: 2,
    idempotency_key: "create-subscription:recovered-request"
  };
  const client = {
    async query(text) {
      if (/SELECT dominio FROM public\.tiendas/.test(text)) return { rows: [{ dominio: tenant.tenantId }] };
      if (/status IN \('queued', 'running'\)/.test(text)) return { rows: [] };
      if (/status = 'failed'/.test(text) && /result->'diagnostic'/.test(text)) return { rows: [blocked] };
      if (/INSERT INTO control_plane\.jobs/.test(text)) return { rows: [inserted] };
      return { rows: [] };
    },
    release() {}
  };
  const repository = createJobRepository({ async connect() { return client; } });

  const result = await repository.enqueueExclusive(tenant, {
    type: "create-subscription",
    payload: inserted.payload,
    idempotencyKey: inserted.idempotency_key,
    maxAttempts: 2,
    allowSubscriptionRecovery: true
  });

  assert.equal(result.id, inserted.id);
  assert.equal(result.status, "queued");
});
