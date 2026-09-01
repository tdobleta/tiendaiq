"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { verifyAndNormalizeWebhook } = require("../src/webhooks/verify-and-normalize");
const { createInboxRepository } = require("../src/platform/postgres/inbox-repository");
const { createWebhookHandlers } = require("../src/webhooks/handlers");

const SECRET = "webhook-secret";
const SHOP = "webhooks.myshopify.com";
const WEBHOOK_ID = "11111111-1111-4111-8111-111111111111";

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

  test("products/update conserva solamente el identificador del producto", () => {
    const body = Buffer.from(JSON.stringify({ id: 44, title: "No debe persistirse", body_html: "<b>ni esto</b>" }));
    const event = verifyAndNormalizeWebhook(body, signedHeaders(body, "products/update"), SECRET);
    assert.deepEqual(event.payload, { product_gid: "gid://shopify/Product/44" });
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

    await handlers["shop/redact"].run(event);
    assert.deepEqual(order, ["delete", "redact", "audit"]);
    assert.match(privacy.tenantReference, /^redacted:[0-9a-f]{64}$/);
    assert.doesNotMatch(privacy.tenantReference, /webhooks\.myshopify/);
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

  test("products/update marca Piloto 01 cuando cambia su fuente", async () => {
    const saved = [];
    const handlers = createWebhookHandlers({
      stores: { async delete() {} }, billing: { async update() {} }, inbox: { async redactShop() {}, async recordPrivacy() {} }, metrics() {},
      pages: {
        async list() { return [{ id: "44", shopify_product_id: "gid://shopify/Product/44" }]; },
        async get() { return { id: "44", data: { template: "piloto-pdp-01", source_hash: "old" } }; },
        async save(_, page) { saved.push(page); }
      },
      products: { async get() { return { id: "gid://shopify/Product/44", title: "Nuevo", description: "", vendor: "", productType: "", options: [], media: { edges: [] }, variants: { edges: [] } }; } }
    });
    const result = await handlers["products/update"].run({ payload: { product_gid: "gid://shopify/Product/44" }, tenant: { tenantId: SHOP } });
    assert.equal(result.updated, 1);
    assert.equal(saved[0].cambios_sin_publicar, true);
    assert.ok(saved[0].desactualizada.detected_at);
  });
});

test("el inbox durable reemplaza la deduplicación en memoria y usa leases", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const db = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
  const repository = fs.readFileSync(path.join(__dirname, "..", "src", "platform", "postgres", "inbox-repository.js"), "utf8");
  const migration = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "0006_durable_webhook_inbox.sql"), "utf8");
  assert.doesNotMatch(server, /WEBHOOKS_VISTOS/);
  assert.match(server, /recibirWebhookDB\(input\)/);
  assert.match(repository, /FOR UPDATE SKIP LOCKED/);
  assert.match(repository, /processed_at < now\(\)/);
  assert.doesNotMatch(repository, /DELETE FROM control_plane\.inbox_events\s+WHERE status = 'failed'/);
  assert.doesNotMatch(db, /removeFailed|failedBefore/);
  assert.match(migration, /ON DELETE SET NULL/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
});
