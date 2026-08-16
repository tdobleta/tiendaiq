"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Anthropic = require("@anthropic-ai/sdk");
const { isAmbiguousProviderError } = require("../adaptador");

test("reconoce los timeouts reales del SDK de Anthropic como efecto ambiguo", () => {
  const error = new Anthropic.APIConnectionTimeoutError();
  assert.equal(isAmbiguousProviderError(error), true);
});

test("reconoce cancelacion del SDK o de la operacion como efecto ambiguo", () => {
  assert.equal(isAmbiguousProviderError(new Anthropic.APIUserAbortError()), true);
  assert.equal(isAmbiguousProviderError(new Error("cancelada"), { aborted: true }), true);
});

test("un rate limit confirmado no se confunde con resultado ambiguo", () => {
  assert.equal(isAmbiguousProviderError({ status: 429, name: "APIError" }), false);
});
