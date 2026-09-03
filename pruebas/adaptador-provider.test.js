"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Anthropic = require("@anthropic-ai/sdk");
const { isAmbiguousProviderError, copyPdp01Base } = require("../adaptador");
const { composePdp01Content } = require("../src/piloto/generate-pdp01");
const { hashSource, validatePdp01, defaultPdp01Editor } = require("../src/piloto/pdp01-contract");

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

test("la semilla de plantilla crea un Piloto 01 válido sin llamar a la IA", () => {
  const source_fields = {
    product_gid: "gid://shopify/Product/321", title: "Producto base", description: "", vendor: "", product_type: "",
    options: [], media_ids: ["gid://shopify/MediaImage/321"],
    variants: [{ id: "gid://shopify/ProductVariant/321", title: "Default Title" }]
  };
  const documento = validatePdp01({
    contract_version: 1,
    template: "piloto-pdp-01",
    source_fields,
    source_hash: hashSource(source_fields),
    content: composePdp01Content(copyPdp01Base(), source_fields),
    evidence: {},
    editor: defaultPdp01Editor()
  }, { origin: "merchant" });
  assert.equal(documento.template, "piloto-pdp-01");
  assert.equal(documento.content.offer.packs.length, 3);
  assert.equal(documento.content.media.hero_media_id, source_fields.media_ids[0]);
});
