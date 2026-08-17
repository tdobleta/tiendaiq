"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { verifyAndNormalizeWebhook } = require("../src/webhooks/verify-and-normalize");
const { createInboxRepository } = require("../src/platform/postgres/inbox-repository");
const { createWebhookHandlers } = require("../src/webhooks/handlers");
const { TenantContext } = require("../src/tenancy/tenant-context");

const SECRET = "webhook-secret";
const SHOP = "webhooks.myshopify.com";
const WEBHOOK_ID = "11111111-1111-4111-8111-111111111111";
const TEST_RELEASE_SHA = "a".repeat(40);

function signedHeaders(body, topic, extra = {}) {
  return {
    "x-shopify-hmac-sha256": crypto.createHmac("sha256", SECRET).update(body).digest("base64"),
    "x-shopify-shop-domain": SHOP,
    "x-shopify-topic": topic,
    "x-shopify-webhook-id": WEBHOOK_ID,
    "x-shopify-api-version": "2026-07",
    ...extra
  };
}

describe("webhook ingress", () => {
  test("verifica HMAC sobre bytes crudos y minimiza datos de clientes", () => {
    const body = Buffer.from(JSON.stringify({
      shop_id: 7,
      customer: { id: 42, email: "persona@example.com", phone: "+549111234" },
      orders_requested: [1, 2, 3]
    }));
    const event = verifyAndNormalizeWebhook(body, signedHeaders(body, "customers/data_request"), SECRET);

    assert.equal(event.shopDomain, SHOP);
    assert.equal(event.topic, "customers/data_request");
    assert.equal(event.id, WEBHOOK_ID);
    assert.equal(event.payload.customer_ref.length, 64);
    assert.doesNotMatch(JSON.stringify(event.payload), /persona@example|phone|orders_requested/);
  });

  test("rechaza una firma inválida antes de confiar en las cabeceras", () => {
    const body = Buffer.from("{}");
    const headers = signedHeaders(body, "app/uninstalled", { "x-shopify-hmac-sha256": "falsa" });
    assert.throws(() => verifyAndNormalizeWebhook(body, headers, SECRET), (error) => error.status === 401);
  });

  test("un evento sin id recibe un UUID determinista para deduplicar retries", () => {
    const body = Buffer.from(JSON.stringify({ shop_id: 7 }));
    const headers = signedHeaders(body, "shop/redact", { "x-shopify-webhook-id": "" });
    const first = verifyAndNormalizeWebhook(body, headers, SECRET);
    const second = verifyAndNormalizeWebhook(body, headers, SECRET);
    assert.equal(first.id, second.id);
    assert.match(first.id, /^[0-9a-f-]{36}$/);
  });
});

function receivePool() {
  const state = { events: new Map(), inserts: 0, calls: [] };
  const client = {
    async query(sql, values = []) {
      const q = String(sql).replace(/\s+/g, " ").trim();
      state.calls.push({ sql: q, values });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(q) || q.startsWith("SELECT set_config")) return { rows: [] };
      if (q.startsWith("INSERT INTO control_plane.inbox_events")) {
        if (state.events.has(values[0])) return { rows: [] };
        const now = new Date().toISOString();
        const row = {
          id: values[0], tenant_id: values[1] || values[0], shop_domain: values[1], topic: values[2],
          payload_hash: values[3], payload: values[4], status: "received", attempts: 0,
          max_attempts: 8, run_after: now, locked_at: null, locked_by: null,
          last_error: null, api_version: values[5], received_at: now, processed_at: null, updated_at: now
        };
        state.events.set(row.id, row);
        state.inserts += 1;
        return { rows: [row] };
      }
      if (q.startsWith("SELECT * FROM control_plane.inbox_events WHERE id")) {
        const row = state.events.get(values[0]);
        return { rows: row && row.shop_domain === values[1] ? [row] : [] };
      }
      throw new Error(`SQL no simulado: ${q}`);
    },
    release() {}
  };
  return { state, async connect() { return client; } };
}

describe("InboxRepository", () => {
  test("expone solo metricas agregadas para readiness", async () => {
    const pool = {
      async connect() { throw new Error("stats no debe abrir una transaccion tenant"); },
      async query(text) {
        assert.equal(text, "SELECT * FROM control_plane.operational_inbox_status()");
        return { rows: [{
          received: "3",
          processing: "2",
          failed: "1",
          failed_recent: "1",
          stale_processing: "0",
          oldest_received_seconds: "42.5"
        }] };
      }
    };
    const status = await createInboxRepository(pool).stats();
    assert.deepEqual(status, {
      received: 3,
      processing: 2,
      failed: 1,
      failedRecent: 1,
      staleProcessing: 0,
      oldestReceivedSeconds: 42.5
    });
  });

  test("un retry persistido devuelve el mismo evento sin insertarlo otra vez", async () => {
    const pool = receivePool();
    const repository = createInboxRepository(pool);
    const input = {
      id: WEBHOOK_ID,
      shopDomain: SHOP,
      topic: "app/uninstalled",
      payloadHash: "hash-1",
      payload: { shop_id: "7" },
      apiVersion: "2026-07"
    };

    const first = await repository.receive(input);
    const second = await repository.receive(input);
    assert.equal(first.inserted, true);
    assert.equal(second.inserted, false);
    assert.equal(first.event.id, second.event.id);
    assert.equal(pool.state.inserts, 1);
  });

  test("el mismo id con otro payload se considera una colisión", async () => {
    const pool = receivePool();
    const repository = createInboxRepository(pool);
    const base = { id: WEBHOOK_ID, shopDomain: SHOP, topic: "app/uninstalled", payloadHash: "hash-1", payload: {} };
    await repository.receive(base);
    await assert.rejects(repository.receive({ ...base, payloadHash: "hash-2" }), /payload diferente/);
  });
});

describe("webhook handlers", () => {
  test("shop/redact borra datos, redacta inbox y deja auditoría seudonimizada", async () => {
    const order = [];
    let privacy;
    const handlers = createWebhookHandlers({
      stores: { async delete() { order.push("delete"); } },
      billing: { async update() {} },
      inbox: {
        async redactShop() { order.push("redact"); },
        async recordPrivacy(workerId, value) { order.push("audit"); privacy = value; }
      },
      metrics() {}
    });
    const event = {
      id: WEBHOOK_ID,
      shopDomain: SHOP,
      lockedBy: "worker:webhooks",
      receivedAt: new Date().toISOString(),
      payload: { shop_id: "7" }
    };

    await handlers["shop/redact"].run(event, { releaseSha: "a".repeat(40) });
    assert.deepEqual(order, ["delete", "redact", "audit"]);
    assert.match(privacy.tenantReference, /^redacted:[0-9a-f]{64}$/);
    assert.doesNotMatch(privacy.tenantReference, /webhooks\.myshopify/);
    assert.equal(privacy.workerReleaseSha, "a".repeat(40));
  });

  test("app/uninstalled no conserva el payload operativo", async () => {
    let redacted;
    const handlers = createWebhookHandlers({
      stores: { async delete() {} },
      billing: { async update() {} },
      inbox: {
        async redactShop(workerId, shop, id) { redacted = { workerId, shop, id }; },
        async recordPrivacy() {}
      },
      metrics() {}
    });
    await handlers["app/uninstalled"].run({ id: WEBHOOK_ID, shopDomain: SHOP, lockedBy: "worker:webhooks" });
    assert.deepEqual(redacted, { workerId: "worker:webhooks", shop: SHOP, id: WEBHOOK_ID });
  });
});

test("la salud operacional del inbox no filtra datos tenant y usa privilegio minimo", () => {
  const migration = fs.readFileSync(
    path.join(__dirname, "..", "db", "migrations", "0015_operational_inbox_health.sql"),
    "utf8"
  );
  assert.match(migration, /CREATE OR REPLACE FUNCTION control_plane\.operational_inbox_status\(\)/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /REVOKE ALL .* FROM PUBLIC/);
  assert.match(migration, /GRANT EXECUTE .* TO tiendaiq_web_runtime/);
  assert.match(migration, /GRANT EXECUTE .* TO tiendaiq_worker_runtime/);
  assert.doesNotMatch(migration, /shop_domain|tenant_id|payload|last_error/);
});

test("el inbox durable reemplaza la deduplicación en memoria y usa leases", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const db = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
  const repository = fs.readFileSync(path.join(__dirname, "..", "src", "platform", "postgres", "inbox-repository.js"), "utf8");
  const migration = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "0006_durable_webhook_inbox.sql"), "utf8");
  assert.doesNotMatch(server, /WEBHOOKS_VISTOS/);
  assert.match(server, /recibirWebhookDB\(input\)/);
  assert.match(repository, /FOR UPDATE SKIP LOCKED/);
  assert.match(repository, /locked_at \+ interval '3 minutes',[\s\S]*'-infinity'::timestamptz/);
  assert.match(repository, /lease_expires_at = now\(\) \+ \(\$2::int \* interval '1 second'\)/);
  assert.match(repository, /worker_release_sha = \$3/);
  assert.match(repository, /locked_by = \$4[\s\S]*worker_release_sha = \$5/);
  assert.match(repository, /locked_by = \$7[\s\S]*worker_release_sha = \$8/);
  assert.match(repository, /processed_at < now\(\)/);
  assert.doesNotMatch(repository, /DELETE FROM control_plane\.inbox_events\s+WHERE status = 'failed'/);
  assert.doesNotMatch(db, /removeFailed|failedBefore/);
  assert.match(migration, /ON DELETE SET NULL/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  const explicitLeases = fs.readFileSync(
    path.join(__dirname, "..", "db", "migrations", "0017_inbox_explicit_leases.sql"),
    "utf8"
  );
  assert.match(explicitLeases, /ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ/);
  assert.match(explicitLeases, /SET lease_expires_at = locked_at \+ interval '3 minutes'/);
  assert.match(explicitLeases, /locked_at \+ interval '3 minutes',[\s\S]*'-infinity'::timestamptz/);
});

test("el inbox renueva y finaliza leases cercados por tenant, tienda y owner", async () => {
  const statements = [];
  const client = {
    async query(text, values = []) {
      statements.push({ text, values });
      if (/UPDATE control_plane\.inbox_events/.test(text)) {
        return { rows: [{
          id: WEBHOOK_ID,
          tenant_id: SHOP,
          shop_domain: SHOP,
          topic: "app/uninstalled",
           payload_hash: "hash",
           status: "processing",
           locked_by: "worker:webhooks",
           worker_release_sha: TEST_RELEASE_SHA
        }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const repository = createInboxRepository({ async connect() { return client; } });
  const context = TenantContext.fromShopDomain(SHOP, { source: "webhook" });
  const event = {
    id: WEBHOOK_ID,
    tenantId: SHOP,
    shopDomain: SHOP,
    lockedBy: "worker:webhooks",
    workerReleaseSha: TEST_RELEASE_SHA
  };

  await repository.renew(context, event, 75);
  await repository.succeed(context, event);
  const updates = statements.filter(({ text }) => /UPDATE control_plane\.inbox_events/.test(text));
  assert.equal(updates.length, 2);
  for (const { text, values } of updates) {
    assert.match(text, /shop_domain = \$2/);
    assert.match(text, /tenant_id = \$3/);
    assert.match(text, /OR tenant_id IS NULL/);
    assert.equal(values[1], SHOP);
    assert.equal(values[2], SHOP);
  }
  assert.match(updates[0].text, /lease_expires_at = now\(\) \+ \(\$5::int \* interval '1 second'\)/);
  assert.equal(updates[0].values[4], 75);

  const other = TenantContext.fromShopDomain("other.myshopify.com", { source: "webhook" });
  await assert.rejects(repository.fail(other, event, new Error("fallo"), 5), /acceso cruzado/);
});

test("un webhook destructivo puede cerrar su lease despues de anonimizar el tenant", async () => {
  const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let completionSql;
  const client = {
    async query(text, values = []) {
      if (/UPDATE control_plane\.inbox_events/.test(text)) {
        completionSql = { text, values };
        return { rows: [{
          id: WEBHOOK_ID,
          tenant_id: null,
          shop_domain: SHOP,
          topic: "shop/redact",
           payload_hash: "hash",
           status: "processed",
           worker_release_sha: TEST_RELEASE_SHA
        }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const repository = createInboxRepository({ async connect() { return client; } });
  const context = TenantContext.fromShopDomain(SHOP, { tenantId, source: "webhook" });
  const completed = await repository.succeed(context, {
    id: WEBHOOK_ID,
    tenantId,
    shopDomain: SHOP,
    lockedBy: "worker:webhooks",
    workerReleaseSha: TEST_RELEASE_SHA
  });

  assert.equal(completed.status, "processed");
  assert.match(completionSql.text, /tenant_id = \$3 OR tenant_id IS NULL/);
  assert.equal(completionSql.values[2], tenantId);
});
