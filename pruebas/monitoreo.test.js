"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { sanitizeTelemetry } = require("../monitoreo");

test("anonimiza identificadores de merchant de forma estable", () => {
  const first = sanitizeTelemetry({
    tienda: "merchant-one.myshopify.com",
    tenant_id: "merchant-one.myshopify.com"
  });
  const second = sanitizeTelemetry({ tienda: "merchant-one.myshopify.com" });

  assert.match(first.tienda, /^[a-f0-9]{16}$/);
  assert.equal(first.tienda, first.tenant_id);
  assert.equal(first.tienda, second.tienda);
  assert.notEqual(first.tienda, "merchant-one.myshopify.com");
});

test("redacta secretos, contenido y datos personales en estructuras anidadas", () => {
  const safe = sanitizeTelemetry({
    authorization: "Bearer token-visible",
    payload: { prompt: "contenido privado" },
    nested: {
      message: "fallo para owner@example.com en demo-shop.myshopify.com",
      api_key: "sk-ant-visible",
      database_url: "postgresql://user:password@db.example.com/app"
    }
  });

  assert.equal(safe.authorization, "[redacted]");
  assert.equal(safe.payload, "[redacted]");
  assert.equal(safe.nested.api_key, "[redacted]");
  assert.equal(safe.nested.database_url, "[redacted]");
  assert.equal(safe.nested.message, "fallo para [email] en [shop]");
});

test("conserva métricas agregadas y corta referencias circulares", () => {
  const input = { queued: 3, latency_ms: 42, lanes: [{ type: "generate-page", running: 2 }] };
  input.self = input;

  const safe = sanitizeTelemetry(input);

  assert.equal(safe.queued, 3);
  assert.equal(safe.latency_ms, 42);
  assert.deepEqual(safe.lanes, [{ type: "generate-page", running: 2 }]);
  assert.equal(safe.self, "[circular]");
});
