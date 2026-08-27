"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {
  needsRefresh,
  credentialFromRefreshResponse,
  refreshCredentialWithShopify
} = require("../src/shopify/offline-token-lifecycle");
const {
  signRefreshRequest,
  verifyRefreshRequest,
  parseRefreshRequest,
  requestRefreshFromBroker
} = require("../src/shopify/token-refresh-broker");
const { credencialExpiringDesdeRespuesta } = require("../auth");
const { gql } = require("../shopify");
const { esperarCredencialRefrescada } = require("../tiendas");

const SHOP = "tienda-prueba-iq.myshopify.com";

test("el contrato expiring exige access/refresh/expiraciones y refresca antes del vencimiento", () => {
  const now = 1_800_000_000_000;
  const credential = credencialExpiringDesdeRespuesta({
    access_token: "access-test", refresh_token: "refresh-test", expires_in: 3600,
    refresh_token_expires_in: 7_776_000
  }, { now });
  assert.equal(needsRefresh(credential, { now }), false);
  assert.equal(needsRefresh(credential, { now: now + 3_400_000 }), true);
  assert.throws(() => credencialExpiringDesdeRespuesta({ access_token: "a" }, { now }), /expiring válida/);
});

test("una solicitud concurrente espera la credencial renovada sin ejecutar otro refresh", async () => {
  const expired = { accessToken: "old", accessExpiresAt: "2020-01-01T00:00:00.000Z" };
  const renewed = { accessToken: "new", accessExpiresAt: "2099-01-01T00:00:00.000Z" };
  const values = [expired, renewed];
  const waits = [];
  const result = await esperarCredencialRefrescada("tienda-prueba-iq.myshopify.com", {
    readCredential: async () => values.shift() || renewed,
    shouldRefresh: (credential) => credential === expired,
    sleep: async (ms) => waits.push(ms),
    delaysMs: [10, 20]
  });
  assert.equal(result, renewed);
  assert.deepEqual(waits, [10, 20]);
});

test("una renovación concurrente que no termina conserva el resultado fail-closed", async () => {
  const expired = { accessToken: "old", accessExpiresAt: "2020-01-01T00:00:00.000Z" };
  const result = await esperarCredencialRefrescada("tienda-prueba-iq.myshopify.com", {
    readCredential: async () => expired,
    shouldRefresh: () => true,
    sleep: async () => {},
    delaysMs: [10, 20]
  });
  assert.equal(result, expired);
});

test("refresh Shopify usa form encoding y nunca devuelve la respuesta remota como error", async () => {
  let request;
  const credential = await refreshCredentialWithShopify({
    shop: SHOP, refreshToken: "refresh-test", clientId: "client-test", clientSecret: "secret-test",
    now: 1_800_000_000_000,
    fetchImpl: async (_url, options) => {
      request = options;
      return { ok: true, status: 200, async json() {
        return { access_token: "renewed-access", refresh_token: "renewed-refresh", expires_in: 3600, refresh_token_expires_in: 7_776_000 };
      } };
    }
  });
  assert.equal(request.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.match(request.body, /grant_type=refresh_token/);
  assert.match(request.body, /refresh_token=refresh-test/);
  assert.equal(credential.accessToken, "renewed-access");
  assert.throws(() => credentialFromRefreshResponse({ access_token: "only" }), /renovables válidas/);
});

test("el broker autentica HMAC, limita clock skew y rechaza replay", () => {
  const secret = "x".repeat(32);
  const now = 1_800_000_000_000;
  const rawBody = JSON.stringify({ shop: SHOP, credentialVersion: 3 });
  const timestamp = String(now);
  const nonce = "11111111-1111-4111-8111-111111111111";
  const signature = signRefreshRequest(secret, { timestamp, nonce, rawBody });
  assert.equal(verifyRefreshRequest({ secret, rawBody, timestamp, nonce, signature, now }), true);
  assert.equal(verifyRefreshRequest({ secret, rawBody, timestamp, nonce, signature, now }), false);
  assert.deepEqual(parseRefreshRequest(rawBody), { shop: SHOP, credentialVersion: 3 });
  assert.equal(parseRefreshRequest(JSON.stringify({ shop: SHOP, credentialVersion: 0 })), null);
});

test("un rechazo de autenticación del broker no se presenta como reautorización Shopify", async () => {
  await assert.rejects(
    requestRefreshFromBroker({
      url: "https://broker.example/internal/shopify-token/refresh",
      secret: "x".repeat(32), shop: SHOP, credentialVersion: 1,
      fetchImpl: async () => ({ ok: false, status: 403 })
    }),
    (error) => error.code === "SHOPIFY_REFRESH_BROKER_UNAUTHORIZED" && error.status === 503
  );
  await assert.rejects(
    requestRefreshFromBroker({
      url: "https://broker.example/internal/shopify-token/refresh",
      secret: "x".repeat(32), shop: SHOP, credentialVersion: 1,
      fetchImpl: async () => ({ ok: false, status: 401 })
    }),
    (error) => error.code === "SHOPIFY_REAUTH_REQUIRED" && error.status === 401
  );
});

test("la instalación expiring se escribe por una única transacción y no deja fallback de token nulo", () => {
  const db = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
  const tiendas = fs.readFileSync(path.join(__dirname, "..", "tiendas.js"), "utf8");
  const instalacion = db.slice(db.indexOf("async function guardarInstalacionExpiringDB"), db.indexOf("async function leerCredencialShopifyDB"));
  const sesion = tiendas.slice(tiendas.indexOf("async function sesionDe"), tiendas.indexOf("module.exports"));
  assert.match(instalacion, /withTenantTransaction/);
  assert.match(instalacion, /INSERT INTO public\.tiendas/);
  assert.match(instalacion, /INSERT INTO control_plane\.shopify_offline_credentials/);
  assert.match(tiendas, /await guardarInstalacionExpiringDB\(d, registro, credential\)/);
  assert.match(sesion, /no tiene una autorización durable/);
});

test("la migración separa refresh tokens del worker, RLS forzado y grants por columna", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "0023_expiring_shopify_offline_credentials.sql"), "utf8");
  assert.match(sql, /refresh_ciphertext text NOT NULL/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE[\s\S]*TO tiendaiq_web_runtime/);
  assert.match(sql, /GRANT SELECT \([\s\S]*access_ciphertext[\s\S]*\) ON TABLE[\s\S]*TO tiendaiq_worker_runtime/);
  assert.doesNotMatch(sql.match(/GRANT SELECT \([\s\S]*?TO tiendaiq_worker_runtime/)?.[0] || "", /refresh_ciphertext/);
});

test("los Blueprints dan broker al worker sin darle client secret Shopify", () => {
  for (const name of ["render.yaml", "render.partner-staging.yaml"]) {
    const yaml = fs.readFileSync(path.join(__dirname, "..", name), "utf8");
    const worker = yaml.slice(yaml.indexOf("type: worker"));
    assert.match(worker, /TOKEN_REFRESH_BROKER_KEY/);
    assert.match(worker, /TOKEN_REFRESH_BROKER_URL/);
    assert.doesNotMatch(worker, /SHOPIFY_CLIENT_SECRET/);
  }
});

test("un 401 de Admin API renueva una vez y pide un nuevo session token sin borrar la tienda", () => {
  const gql = fs.readFileSync(path.join(__dirname, "..", "shopify.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(gql, /typeof sesion\.refresh === "function"/);
  assert.match(gql, /refreshed: true/);
  assert.match(server, /X-Shopify-Retry-Invalid-Session-Request/);
  const reauthBlock = server.slice(server.indexOf('if (e.code === "SHOPIFY_REAUTH_REQUIRED")'));
  assert.doesNotMatch(reauthBlock.slice(0, 300), /borrarTienda/);
});

test("GraphQL reintenta exactamente una vez con la sesión renovada", async () => {
  const original = global.fetch;
  let calls = 0;
  let refreshed = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) return { status: 401, ok: false };
    return { status: 200, ok: true, async json() { return { data: { ok: true } }; } };
  };
  try {
    const data = await gql("query { shop { name } }", {}, {
      tienda: SHOP,
      token: "old",
      async refresh() { refreshed += 1; return { tienda: SHOP, token: "new" }; }
    });
    assert.deepEqual(data, { ok: true });
    assert.equal(calls, 2);
    assert.equal(refreshed, 1);
  } finally {
    global.fetch = original;
  }
});
