"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  INVENTORY_QUERY,
  PAGE_VERSION_SUMMARY_QUERY,
  inventariarAvatares,
  resumirReferencia
} = require("../scripts/inventariar-avatares-publicados");

test("el inventario de avatares sólo consulta referencias existentes", () => {
  assert.match(INVENTORY_QUERY, /^\s*SELECT\b/i);
  assert.doesNotMatch(INVENTORY_QUERY, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
  assert.match(INVENTORY_QUERY, /datos->>'estado' = 'publicada'/);
  assert.match(INVENTORY_QUERY, /https\?:\/\//);
  assert.match(PAGE_VERSION_SUMMARY_QUERY, /^\s*SELECT\b/i);
  assert.match(PAGE_VERSION_SUMMARY_QUERY, /app_data\.page_versions/);
  assert.doesNotMatch(PAGE_VERSION_SUMMARY_QUERY, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
});

test("el inventario no expone URLs completas por defecto", () => {
  const reference = resumirReferencia({
    tienda: "demo.myshopify.com",
    id: "page-1",
    actualizada: "2026-08-30T00:00:00.000Z",
    estado: "publicada",
    avatar_url: "https://cdn.shopify.com/s/files/1/avatar.png"
  });

  assert.equal(reference.host, "cdn.shopify.com");
  assert.equal(reference.estado, "publicada");
  assert.equal(reference.avatarUrl, undefined);
  assert.match(reference.referenciaHash, /^[a-f0-9]{16}$/);
});

test("el inventario agrega el estado de page_versions sin exponer documentos", async () => {
  class FakePool {
    async query(sql) {
      if (sql === INVENTORY_QUERY) {
        return { rows: [{
          tienda: "demo.myshopify.com",
          id: "page-1",
          actualizada: "2026-08-30T00:00:00.000Z",
          estado: "publicada",
          avatar_url: "https://cdn.shopify.com/s/files/1/avatar.png"
        }] };
      }
      if (sql === PAGE_VERSION_SUMMARY_QUERY) {
        return { rows: [{
          total_versiones: 7,
          versiones_de_paginas_publicadas: 3,
          versiones_publicadas_con_avatar: 2
        }] };
      }
      throw new Error("Consulta inesperada");
    }

    async end() {}
  }

  const result = await inventariarAvatares({
    databaseUrl: "postgres://localhost:5432/tiendaiq",
    PoolImplementation: FakePool
  });

  assert.equal(result.total, 1);
  assert.equal(result.referencias[0].avatarUrl, undefined);
  assert.deepEqual(result.pageVersions, {
    total_versiones: 7,
    versiones_de_paginas_publicadas: 3,
    versiones_publicadas_con_avatar: 2
  });
});

test("el modo resumen no expone referencias individuales", async () => {
  class FakePool {
    async query(sql) {
      if (sql === INVENTORY_QUERY) return { rows: [] };
      if (sql === PAGE_VERSION_SUMMARY_QUERY) return { rows: [] };
      throw new Error("Consulta inesperada");
    }

    async end() {}
  }

  const result = await inventariarAvatares({
    databaseUrl: "postgres://localhost:5432/tiendaiq",
    PoolImplementation: FakePool,
    summaryOnly: true
  });

  assert.equal(result.total, 0);
  assert.equal("referencias" in result, false);
});

test("el workflow protegido sólo ejecuta el inventario resumido", () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "inventory-legacy-review-avatars-partner-staging.yml"),
    "utf8"
  );

  assert.match(workflow, /environment:\s*partner-staging/);
  assert.match(workflow, /INVENTORY_LEGACY_REVIEW_AVATARS/);
  assert.match(workflow, /PARTNER_STAGING_MIGRATION_DATABASE_URL/);
  assert.match(workflow, /audit:legacy-review-avatars -- --summary/);
  assert.doesNotMatch(workflow, /--include-urls|ALLOW_AVATAR_URL_OUTPUT|RENDER_|SHOPIFY_/);
});
