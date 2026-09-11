"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PageWritePolicyError,
  assertCompatiblePageWrite
} = require("../src/section-pipeline/page-write-policy");

const sectionPageRecord = {
  section_page: { contractVersion: 1, revision: 3 }
};

test("una página por secciones rechaza el payload genérico", () => {
  assert.throws(
    () => assertCompatiblePageWrite({ persistedData: sectionPageRecord, body: { data: {} } }),
    (error) => error instanceof PageWritePolicyError
      && error.code === "PAGE_WRITE_CONTRACT_CONFLICT"
      && error.status === 409
  );
});

test("una página por secciones rechaza también el documento legacy", () => {
  assert.throws(
    () => assertCompatiblePageWrite({ persistedData: sectionPageRecord, body: { documento: {} } }),
    /usa el editor por secciones/
  );
});

test("la ruta canónica de section_page sigue permitida", () => {
  assert.doesNotThrow(() => assertCompatiblePageWrite({
    persistedData: sectionPageRecord,
    body: { section_page: { contractVersion: 1, revision: 3 } }
  }));
});

test("las páginas legacy conservan su ruta compatible", () => {
  assert.doesNotThrow(() => assertCompatiblePageWrite({
    persistedData: { piloto_pdp_01: {} },
    body: { data: { piloto_pdp_01: {} } }
  }));
});
