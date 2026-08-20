"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Anthropic = require("@anthropic-ai/sdk");
const { TenantContext } = require("../src/tenancy/tenant-context");
const { createGenerationRepository } = require("../src/platform/postgres/generation-repository");
const { createGeneratePageHandler } = require("../src/jobs/generate-page-handler");
const { PAGE_SCHEMA_VERSION } = require("../src/domain/page-contract");
const { isAmbiguousProviderError, normalizeProviderError, retryAfterSeconds } = require("../adaptador");

const tenant = TenantContext.fromShopDomain("generation.myshopify.com", { source: "internal-job" });
const period = "2026-08";

function generationPool(initialUsage = 2, { globalPending = 0, tenantPending = 0 } = {}) {
  const state = {
    usage: initialUsage,
    jobs: [],
    reservations: [],
    pages: new Map(),
    usageUpdates: 0,
    calls: [],
    globalPending,
    tenantPending
  };
  const client = {
    async query(sql, values = []) {
      const q = String(sql).replace(/\s+/g, " ").trim();
      state.calls.push({ sql: q, values });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(q) || q.startsWith("SELECT set_config")) return { rows: [] };
      if (q.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [{}] };
      if (q.includes("generation_queue_pressure()")) {
        return { rows: [{ queued: state.globalPending, running: 0, oldest_queued_seconds: 0 }] };
      }
      if (q.startsWith("SELECT count(*)::int AS pending")) {
        return { rows: [{ pending: state.tenantPending }] };
      }
      if (q.startsWith("SELECT * FROM control_plane.jobs")) {
        return { rows: state.jobs.filter((j) => j.tenant_id === values[0] && j.idempotency_key === values[1]).slice(0, 1) };
      }
      if (q.includes("usage_reservations") && q.includes("job_id = $2")) {
        return { rows: state.reservations.filter((r) => r.tenant_id === values[0] && r.job_id === values[1]) };
      }
      if (q.startsWith("SELECT datos FROM public.tiendas")) {
        return { rows: [{ datos: { uso: { [period]: state.usage } } }] };
      }
      if (q.startsWith("INSERT INTO control_plane.jobs")) {
        const now = new Date().toISOString();
        const row = {
          id: values[0], tenant_id: values[1], type: "generate-page", payload: values[2],
          status: "queued", attempts: 0, max_attempts: values[3], run_after: now,
          locked_at: null, locked_by: null, last_error: null, result: null,
          idempotency_key: values[4], created_at: now, updated_at: now, completed_at: null
        };
        state.jobs.push(row);
        return { rows: [row] };
      }
      if (q.startsWith("INSERT INTO control_plane.usage_reservations")) {
        const now = new Date().toISOString();
        const row = {
          id: values[0], tenant_id: values[1], job_id: values[2], operation_type: "page_generation",
          idempotency_key: values[3], period: values[4], units: 1, quota_limit: values[5],
          status: "reserved", last_error: null, created_at: now, updated_at: now,
          committed_at: null, released_at: null
        };
        state.reservations.push(row);
        return { rows: [row] };
      }
      if (q.startsWith("UPDATE public.tiendas")) {
        state.usage = Number(values[2]);
        state.usageUpdates += 1;
        return { rows: [] };
      }
      if (q.includes("usage_reservations") && q.includes("id = $2 FOR UPDATE")) {
        return { rows: state.reservations.filter((r) => r.tenant_id === values[0] && r.id === values[1]) };
      }
      if (q.startsWith("INSERT INTO public.paginas")) {
        state.pages.set(`${values[0]}:${values[1]}`, structuredClone(values[2]));
        return { rows: [] };
      }
      if (q.startsWith("UPDATE control_plane.usage_reservations")) {
        const row = state.reservations.find((r) => r.tenant_id === values[0] && r.id === values[1] && r.status === "reserved");
        if (!row) return { rows: [] };
        const now = new Date().toISOString();
        if (q.includes("status = 'committed'")) {
          Object.assign(row, { status: "committed", committed_at: now, updated_at: now, last_error: null });
        } else {
          Object.assign(row, { status: "released", released_at: now, updated_at: now, last_error: values[2] });
        }
        return { rows: [row] };
      }
      if (q.includes("usage_reservations") && q.includes("id = $2")) {
        return { rows: state.reservations.filter((r) => r.tenant_id === values[0] && r.id === values[1]) };
      }
      throw new Error(`SQL no simulado: ${q}`);
    },
    release() {}
  };
  return { state, async connect() { return client; } };
}

describe("GenerationRepository", () => {
  test("la misma idempotency key reserva y encola una sola vez", async () => {
    const pool = generationPool(2);
    const repository = createGenerationRepository(pool);
    const options = {
      payload: { productId: "gid://shopify/Product/42" },
      idempotencyKey: "generate:req-1",
      period,
      limit: 3
    };

    const first = await repository.enqueue(tenant, options);
    const second = await repository.enqueue(tenant, options);

    assert.equal(first.job.id, second.job.id);
    assert.equal(pool.state.jobs.length, 1);
    assert.equal(pool.state.reservations.length, 1);
    assert.equal(pool.state.usage, 3);
    assert.equal(pool.state.usageUpdates, 1);
  });

  test("el lock de tienda impide superar el límite", async () => {
    const pool = generationPool(3);
    const repository = createGenerationRepository(pool);

    await assert.rejects(
      repository.enqueue(tenant, {
        payload: { productId: "gid://shopify/Product/42" },
        idempotencyKey: "generate:req-limit",
        period,
        limit: 3
      }),
      (error) => error.status === 402
    );
    assert.equal(pool.state.jobs.length, 0);
    assert.equal(pool.state.usageUpdates, 0);
  });

  test("confirmar vuelve durable la página y liberar después no devuelve cupo", async () => {
    const pool = generationPool(1);
    const repository = createGenerationRepository(pool);
    const queued = await repository.enqueue(tenant, {
      payload: { productId: "gid://shopify/Product/42" },
      idempotencyKey: "generate:req-commit",
      period,
      limit: 3
    });

    await repository.finalize(tenant, {
      reservationId: queued.reservation.id,
      pageId: "42",
      page: { id: "42", data: { titulo: "Lista" } }
    });
    await repository.release(tenant, queued.reservation.id, new Error("tardío"));

    assert.equal(pool.state.reservations[0].status, "committed");
    const persistedPage = pool.state.pages.get(`${tenant.tenantId}:42`);
    assert.equal(persistedPage.schema_version, PAGE_SCHEMA_VERSION);
    assert.equal(persistedPage.data.titulo, "Lista");
    assert.equal(pool.state.usage, 2);
  });

  test("confirmar rechaza paginas generadas fuera del contrato", async () => {
    const pool = generationPool(1);
    const repository = createGenerationRepository(pool);
    const queued = await repository.enqueue(tenant, {
      payload: { productId: "gid://shopify/Product/42" },
      idempotencyKey: "generate:req-contract",
      period,
      limit: 3
    });

    await assert.rejects(
      repository.finalize(tenant, {
        reservationId: queued.reservation.id,
        pageId: "42",
        page: { id: "otra", data: { titulo: "Lista" } }
      }),
      /no coincide/
    );

    assert.equal(pool.state.reservations[0].status, "reserved");
    assert.equal(pool.state.pages.size, 0);
  });

  test("liberar dos veces descuenta exactamente una", async () => {
    const pool = generationPool(1);
    const repository = createGenerationRepository(pool);
    const queued = await repository.enqueue(tenant, {
      payload: { productId: "gid://shopify/Product/42" },
      idempotencyKey: "generate:req-release",
      period,
      limit: 3
    });

    await repository.release(tenant, queued.reservation.id, new Error("falló"));
    await repository.release(tenant, queued.reservation.id, new Error("falló otra vez"));

    assert.equal(pool.state.reservations[0].status, "released");
    assert.equal(pool.state.usage, 1);
    assert.equal(pool.state.usageUpdates, 2, "un update reserva y uno libera");
  });

  test("limita generaciones activas por tenant sin consumir cupo", async () => {
    const pool = generationPool(1, { globalPending: 4, tenantPending: 2 });
    const repository = createGenerationRepository(pool);

    await assert.rejects(
      repository.enqueue(tenant, {
        payload: { productId: "gid://shopify/Product/42" },
        idempotencyKey: "generate:req-tenant-pressure",
        period,
        limit: 10,
        maxPending: 2,
        maxGlobalPending: 120
      }),
      (error) => error.status === 429 && error.retryAfter === 30
    );
    assert.equal(pool.state.jobs.length, 0);
    assert.equal(pool.state.usageUpdates, 0);
  });

  test("corta admision global antes de reservar cupo", async () => {
    const pool = generationPool(1, { globalPending: 120, tenantPending: 0 });
    const repository = createGenerationRepository(pool);

    await assert.rejects(
      repository.enqueue(tenant, {
        payload: { productId: "gid://shopify/Product/42" },
        idempotencyKey: "generate:req-global-pressure",
        period,
        limit: 10,
        maxPending: 2,
        maxGlobalPending: 120
      }),
      (error) => error.status === 503 && error.retryAfter === 60
    );
    assert.equal(pool.state.jobs.length, 0);
    assert.equal(pool.state.usageUpdates, 0);
  });
});

describe("GeneratePageHandler", () => {
  const baseJob = {
    id: "job-1",
    tenantId: tenant.tenantId,
    tenant,
    payload: { reservationId: "reservation-1", productId: "gid://shopify/Product/42" }
  };

  test("genera y confirma la reserva junto con la página", async () => {
    let finalized;
    const handler = createGeneratePageHandler({
      sessions: { async get() { return { tienda: tenant.tenantId, token: "token" }; } },
      generations: {
        async getReservation() { return { status: "reserved" }; },
        async transitionProvider(context, id, command) {
          assert.equal(command.action, "begin");
          return { started: true, state: "provider_in_flight", attemptId: "attempt-1" };
        },
        async finalize(context, value) { finalized = value; },
        async release() {}
      },
      pages: { async get() { return null; } },
      async generate(productId, session, options) {
        await options.beforeProviderCall();
        return { data: { titulo: "IA" }, urls: {}, avisos: [], uso: { input_tokens: 10 } };
      },
      metrics() {}
    });

    const result = await handler.run(baseJob);
    assert.equal(result.pageId, "42");
    assert.equal(finalized.page.data.titulo, "IA");
    assert.equal(finalized.reservationId, "reservation-1");
  });

  test("un retry confirmado recupera la página sin volver a llamar a IA", async () => {
    let generations = 0;
    const handler = createGeneratePageHandler({
      sessions: { async get() { throw new Error("no debe pedir sesión"); } },
      generations: {
        async getReservation() { return { status: "committed" }; },
        async finalize() {},
        async release() {}
      },
      pages: { async get() { return { id: "42" }; } },
      async generate() { generations += 1; },
      metrics() {}
    });

    assert.deepEqual(await handler.run(baseJob), { pageId: "42", recovered: true });
    assert.equal(generations, 0);
  });

  test("reintenta solo la confirmacion idempotente sin volver a llamar a IA", async () => {
    let generated = 0;
    let finalized = 0;
    const handler = createGeneratePageHandler({
      sessions: { async get() { return { tienda: tenant.tenantId, token: "token" }; } },
      generations: {
        async getReservation() { return { status: "reserved" }; },
        async transitionProvider(context, id, command) {
          assert.equal(command.action, "begin");
          return { started: true, state: "provider_in_flight", attemptId: "attempt-retry" };
        },
        async finalize() {
          finalized += 1;
          if (finalized < 3) throw new Error("Postgres temporal");
        },
        async release() {}
      },
      pages: { async get() { return null; } },
      async generate(productId, session, options) {
        await options.beforeProviderCall();
        generated += 1;
        return { data: { titulo: "IA" }, urls: {}, avisos: [], uso: {} };
      },
      finalizeRetryMs: 1,
      metrics() {}
    });

    const result = await handler.run(baseJob);
    assert.equal(result.pageId, "42");
    assert.equal(generated, 1);
    assert.equal(finalized, 3);
  });

  test("un resultado sin confirmar queda terminal y no libera la reserva", async () => {
    let released = 0;
    const handler = createGeneratePageHandler({
      sessions: { async get() { return { tienda: tenant.tenantId, token: "token" }; } },
      generations: {
        async getReservation() { return { status: "reserved" }; },
        async transitionProvider(context, id, command) {
          if (command.action === "begin") return { started: true, state: "provider_in_flight", attemptId: "attempt-finalize" };
          assert.equal(command.action, "ambiguous");
          return { changed: true, state: "ambiguous", attemptId: command.attemptId };
        },
        async finalize() { throw new Error("Postgres caido"); },
        async release() { released += 1; }
      },
      pages: { async get() { return null; } },
      async generate(productId, session, options) {
        await options.beforeProviderCall();
        return { data: {}, urls: {}, avisos: [], uso: {} };
      },
      finalizeRetryMs: 1,
      metrics() {}
    });

    let ambiguous;
    await assert.rejects(handler.run(baseJob), (error) => {
      ambiguous = error;
      return error.code === "GENERATION_FINALIZE_AMBIGUOUS"
        && error.nonRetryable
        && error.skipCompensation;
    });
    assert.equal(handler.needsCompensation(baseJob, ambiguous), false);
    await handler.onTerminalFailure(baseJob, ambiguous);
    assert.equal(released, 0);
  });

  test("una recuperación provider_in_flight queda ambigua y no repite Anthropic", async () => {
    let generated = 0;
    let sessions = 0;
    const transitions = [];
    const handler = createGeneratePageHandler({
      sessions: { async get() { sessions += 1; } },
      generations: {
        async getReservation() {
          return { status: "reserved", providerState: { state: "provider_in_flight", attemptId: "attempt-lost" } };
        },
        async transitionProvider(context, id, command) {
          transitions.push(command);
          return { started: false, state: "ambiguous", attemptId: "attempt-lost" };
        },
        async finalize() {},
        async release() {}
      },
      pages: { async get() { return null; } },
      async generate() { generated += 1; },
      metrics() {}
    });

    await assert.rejects(
      handler.run(baseJob),
      (error) => error.code === "GENERATION_PROVIDER_AMBIGUOUS" && error.nonRetryable && error.skipCompensation
    );
    assert.equal(sessions, 0);
    assert.equal(generated, 0);
    assert.deepEqual(transitions.map((item) => item.action), ["begin"]);
  });

  test("APIConnectionError deja el intento ambiguo y conserva la reserva", async () => {
    let released = 0;
    const transitions = [];
    const handler = createGeneratePageHandler({
      sessions: { async get() { return { tienda: tenant.tenantId, token: "token" }; } },
      generations: {
        async getReservation() { return { status: "reserved" }; },
        async transitionProvider(context, id, command) {
          transitions.push(command);
          if (command.action === "begin") return { started: true, state: "provider_in_flight", attemptId: "attempt-network" };
          return { changed: true, state: command.action, attemptId: command.attemptId };
        },
        async finalize() {},
        async release() { released += 1; }
      },
      pages: { async get() { return null; } },
      async generate(productId, session, options) {
        await options.beforeProviderCall();
        const error = new Anthropic.APIConnectionError({ message: "socket cerrado" });
        error.code = "ANTHROPIC_AMBIGUOUS";
        error.nonRetryable = true;
        error.skipCompensation = true;
        throw error;
      },
      metrics() {}
    });

    let failure;
    await assert.rejects(handler.run(baseJob), (error) => {
      failure = error;
      return error.code === "ANTHROPIC_AMBIGUOUS" && error.skipCompensation;
    });
    await handler.onTerminalFailure(baseJob, failure);
    assert.equal(released, 0);
    assert.deepEqual(transitions.map((item) => item.action), ["begin", "ambiguous"]);
  });

  test("un 429 confirmado limpia el intento y conserva Retry-After para el runner", async () => {
    const transitions = [];
    const handler = createGeneratePageHandler({
      sessions: { async get() { return { tienda: tenant.tenantId, token: "token" }; } },
      generations: {
        async getReservation() { return { status: "reserved" }; },
        async transitionProvider(context, id, command) {
          transitions.push(command);
          if (command.action === "begin") return { started: true, state: "provider_in_flight", attemptId: "attempt-429" };
          return { changed: true, state: null, attemptId: command.attemptId };
        },
        async finalize() {},
        async release() {}
      },
      pages: { async get() { return null; } },
      async generate(productId, session, options) {
        await options.beforeProviderCall();
        const error = new Error("rate limited");
        error.status = 429;
        error.retryAfter = 7;
        throw error;
      },
      metrics() {}
    });

    await assert.rejects(handler.run(baseJob), (error) => error.status === 429 && error.retryAfter === 7);
    assert.deepEqual(transitions.map((item) => item.action), ["begin", "clear"]);
  });

  test("falla cerrado si el adaptador omite el checkpoint pre-proveedor", async () => {
    const handler = createGeneratePageHandler({
      sessions: { async get() { return { tienda: tenant.tenantId, token: "token" }; } },
      generations: {
        async getReservation() { return { status: "reserved" }; },
        async transitionProvider() { throw new Error("no debe ejecutarse"); },
        async finalize() { throw new Error("no debe confirmar"); },
        async release() {}
      },
      pages: { async get() { return null; } },
      async generate() { return { data: {}, urls: {}, avisos: [], uso: {} }; },
      metrics() {}
    });

    await assert.rejects(
      handler.run(baseJob),
      (error) => error.code === "GENERATION_PROVIDER_AMBIGUOUS" && error.skipCompensation
    );
  });
});

describe("Contrato Anthropic", () => {
  test("APIConnectionError se clasifica como resultado ambiguo", () => {
    const error = new Anthropic.APIConnectionError({ message: "conexión interrumpida" });
    assert.equal(isAmbiguousProviderError(error), true);
  });

  test("normaliza Retry-After en segundos, milisegundos y fecha HTTP", () => {
    assert.equal(retryAfterSeconds({ "retry-after": "2.1" }), 3);
    assert.equal(retryAfterSeconds({ "retry-after-ms": "1250" }), 2);
    const now = Date.parse("2026-08-13T12:00:00Z");
    assert.equal(retryAfterSeconds({ "Retry-After": "Thu, 13 Aug 2026 12:00:04 GMT" }, now), 4);

    const error = { headers: new Headers({ "retry-after": "6" }) };
    assert.equal(normalizeProviderError(error), error);
    assert.equal(error.retryAfter, 6);
  });
});

test("el ledger de uso está protegido por RLS", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "0005_usage_reservations.sql"), "utf8");
  assert.match(sql, /UNIQUE \(tenant_id, operation_type, idempotency_key\)/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /tenant_id = current_setting\('app\.tenant_id', true\)/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/, "el ledger no se borra silenciosamente al purgar jobs");
});
