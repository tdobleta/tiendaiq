"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { pageIdFromCreationRequest } = require("../src/domain/page-identity");

test("cada solicitud nueva tiene una página propia y los reintentos son idempotentes", () => {
  const first = pageIdFromCreationRequest("550e8400-e29b-41d4-a716-446655440000");
  const retry = pageIdFromCreationRequest("550E8400-E29B-41D4-A716-446655440000");
  const second = pageIdFromCreationRequest("6ba7b810-9dad-41d1-80b4-00c04fd430c8");

  assert.equal(first, "page-550e8400-e29b-41d4-a716-446655440000");
  assert.equal(retry, first);
  assert.notEqual(second, first);
  assert.equal(pageIdFromCreationRequest("no-es-un-uuid"), null);
});
