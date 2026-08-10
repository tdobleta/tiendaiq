"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const {
  TenantContext,
  normalizeShopDomain,
  requireTenantContext,
  assertTenant
} = require("../src/tenancy/tenant-context");
const { withTenantTransaction } = require("../src/platform/postgres/with-tenant-transaction");

describe("TenantContext", () => {
  test("normaliza el dominio y queda inmutable", () => {
    const context = TenantContext.fromShopDomain("https://Demo-Shop.myshopify.com/admin", {
      source: "session-token",
      requestId: "req-1"
    });
    assert.equal(context.tenantId, "demo-shop.myshopify.com");
    assert.equal(context.shopDomain, "demo-shop.myshopify.com");
    assert.equal(Object.isFrozen(context), true);
    assert.throws(() => { context.tenantId = "otra.myshopify.com"; }, TypeError);
  });

  test("rechaza dominios y fuentes no confiables", () => {
    assert.throws(() => TenantContext.fromShopDomain("ejemplo.com"), /shopDomain/);
    assert.throws(
      () => TenantContext.fromShopDomain("demo.myshopify.com", { source: "request-body" }),
      /fuente confiable/
    );
  });

  test("no permite usar un objeto parecido ni cruzar tenant", () => {
    const context = TenantContext.fromShopDomain("a.myshopify.com");
    assert.throws(() => requireTenantContext({ ...context }), /TenantContext/);
    assert.throws(() => assertTenant(context, "b.myshopify.com"), /acceso cruzado/);
    assert.equal(assertTenant(context, "a.myshopify.com"), context);
  });

  test("normaliza valores de Shopify", () => {
    assert.equal(normalizeShopDomain(" HTTPS://SHOP-1.MYSHOPIFY.COM/admin "), "shop-1.myshopify.com");
  });
});

describe("withTenantTransaction", () => {
  function fakePool({ failWork = false, failRollback = false } = {}) {
    const calls = [];
    const client = {
      async query(sql, values) {
        calls.push({ sql, values });
        if (sql === "ROLLBACK" && failRollback) throw new Error("rollback fallo");
        return { rows: [] };
      },
      release() { calls.push({ sql: "RELEASE" }); }
    };
    return {
      calls,
      async connect() { return client; },
      async work() {
        if (failWork) throw new Error("fallo de dominio");
        return "ok";
      }
    };
  }

  test("fija app.tenant_id antes del trabajo y confirma", async () => {
    const pool = fakePool();
    const context = TenantContext.fromShopDomain("a.myshopify.com");
    const result = await withTenantTransaction(pool, context, (client) => pool.work(client));
    assert.equal(result, "ok");
    assert.deepEqual(pool.calls.map((c) => c.sql), [
      "BEGIN",
      "SELECT set_config('app.tenant_id', $1, true)",
      "COMMIT",
      "RELEASE"
    ]);
    assert.deepEqual(pool.calls[1].values, ["a.myshopify.com"]);
  });

  test("hace rollback y libera la conexion cuando falla", async () => {
    const pool = fakePool({ failWork: true });
    const context = TenantContext.fromShopDomain("a.myshopify.com");
    await assert.rejects(withTenantTransaction(pool, context, (client) => pool.work(client)), /fallo de dominio/);
    assert.deepEqual(pool.calls.map((c) => c.sql), [
      "BEGIN",
      "SELECT set_config('app.tenant_id', $1, true)",
      "ROLLBACK",
      "RELEASE"
    ]);
  });
});
