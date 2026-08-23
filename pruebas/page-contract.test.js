"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PAGE_SCHEMA_VERSION,
  PageContractError,
  normalizePageRecord,
  normalizeStoredPageRecord
} = require("../src/domain/page-contract");

function page(overrides = {}) {
  return {
    id: "page_123",
    data: { titulo: "Producto" },
    estado: "borrador",
    ...overrides
  };
}

test("normaliza una pagina con contrato v1 sin mutar el caller", () => {
  const current = page();
  const normalized = normalizePageRecord(current, { expectedId: "page_123" });

  assert.equal(normalized.schema_version, PAGE_SCHEMA_VERSION);
  assert.equal(current.schema_version, undefined);
  assert.notEqual(normalized, current);
});

test("el contrato no permite fabricar claims verificados desde data editable", () => {
  const current = page({
    data: {
      compliance: {
        claims_verified: true,
        review_source: "https://merchant.example/reviews",
        statistics_source: "https://merchant.example/stats",
        policy_source: "https://merchant.example/policy"
      }
    }
  });

  const normalized = normalizePageRecord(current);

  assert.equal(normalized.data.compliance.claims_verified, false);
  assert.equal(current.data.compliance.claims_verified, true);
  assert.equal(normalized.data.compliance.review_source, current.data.compliance.review_source);
  assert.equal(normalized.data.compliance.statistics_source, current.data.compliance.statistics_source);
  assert.equal(normalized.data.compliance.policy_source, current.data.compliance.policy_source);
});

test("la lectura de un registro versionado tambien cierra claims fabricados", () => {
  const stored = normalizeStoredPageRecord(page({
    data: { compliance: { claims_verified: true, review_source: "https://merchant.example/reviews" } },
    schema_version: PAGE_SCHEMA_VERSION
  }));

  assert.equal(stored.data.compliance.claims_verified, false);
});

test("rechaza paginas sin un objeto data", () => {
  assert.throws(
    () => normalizePageRecord(page({ data: null })),
    (error) => error instanceof PageContractError && error.code === "PAGE_CONTRACT_INVALID"
  );
});

test("rechaza persistir una pagina con un id distinto", () => {
  assert.throws(
    () => normalizePageRecord(page(), { expectedId: "page_otra" }),
    /no coincide/
  );
});

test("rechaza una version de contrato que el backend no conoce", () => {
  assert.throws(
    () => normalizePageRecord(page({ schema_version: 2 })),
    /no soportada/
  );
});

test("rechaza registros versionados que omiten data", () => {
  for (const schemaVersion of [PAGE_SCHEMA_VERSION, PAGE_SCHEMA_VERSION + 1]) {
    assert.throws(
      () =>
        normalizeStoredPageRecord({
          id: "page_123",
          schema_version: schemaVersion
        }),
      /requiere data/
    );
  }
});

test("valida una pagina heredada sin cambiar su forma publicada", () => {
  const legacy = {
    id: "page_legacy",
    estado: "borrador",
    facetas: { hero: { titulo: "Titulo heredado", galeria: ["hero"] } },
    urls: { hero: "https://cdn.example/hero.jpg" }
  };

  const normalized = normalizeStoredPageRecord(legacy, { expectedId: "page_legacy" });

  assert.deepEqual(normalized, legacy);
  assert.notEqual(normalized, legacy);
  assert.equal(normalized.estado, "borrador");
  assert.equal(normalized.facetas.hero.titulo, "Titulo heredado");
  assert.equal(normalized.urls.hero, "https://cdn.example/hero.jpg");
  assert.equal(normalized.data, undefined);
  assert.equal(normalized.schema_version, undefined);
});

test("la lectura de una pagina heredada tambien cierra claims fabricados", () => {
  const legacy = {
    id: "page_legacy",
    compliance: { claims_verified: true, review_source: "https://merchant.example/reviews" },
    facetas: { hero: { titulo: "Titulo heredado" } }
  };

  const normalized = normalizeStoredPageRecord(legacy, { expectedId: "page_legacy" });

  assert.equal(normalized.compliance.claims_verified, false);
  assert.equal(normalized.compliance.review_source, legacy.compliance.review_source);
  assert.deepEqual(normalized.facetas, legacy.facetas);
  assert.equal(normalized.data, undefined);
  assert.equal(normalized.schema_version, undefined);
});

test("preserva paginas heredadas que no almacenaban el id dentro del JSON", () => {
  const legacy = { estado: "publicando", active_job_id: "job_123" };

  const normalized = normalizeStoredPageRecord(legacy, { expectedId: "page_legacy" });

  assert.deepEqual(normalized, legacy);
  assert.equal(Object.hasOwn(normalized, "id"), false);
});
