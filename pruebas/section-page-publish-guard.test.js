"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createProductPage } = require("../src/section-pipeline/page-pipeline");
const {
  SectionPagePublishError,
  assertSectionPagePublishable,
  sectionPageProjection
} = require("../src/shopify/section-page-publish-guard");

function data(variantId = "gid://shopify/ProductVariant/7") {
  const productId = "gid://shopify/Product/42";
  return {
    fuente: { shopify_product_id: productId },
    section_page: createProductPage({
      product: { id: productId, title: "Camisa", variants: [{ id: variantId, title: "Única", price: "20.00" }] }
    })
  };
}

test("publica sólo cuando el producto y cada variante siguen vivos en Shopify", async () => {
  const result = await assertSectionPagePublishable(data(), {}, {
    async query(_query, variables) {
      assert.deepEqual(variables, { id: "gid://shopify/Product/42" });
      return { product: { id: variables.id, variants: { nodes: [{ id: "gid://shopify/ProductVariant/7" }] } } };
    }
  });
  assert.deepEqual(result, { productId: "gid://shopify/Product/42", variantCount: 1 });
});

test("rechaza referencias cruzadas y variantes eliminadas", async () => {
  const crossed = data();
  crossed.fuente.shopify_product_id = "gid://shopify/Product/99";
  assert.throws(() => sectionPageProjection(crossed), SectionPagePublishError);
  await assert.rejects(
    assertSectionPagePublishable(data(), {}, {
      async query() {
        return { product: { id: "gid://shopify/Product/42", variants: { nodes: [{ id: "gid://shopify/ProductVariant/8" }] } } };
      }
    }),
    (error) => error instanceof SectionPagePublishError && error.nonRetryable === true
  );
});

test("la extensión reconoce el contrato nuevo antes de los renderers heredados", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const liquid = fs.readFileSync(path.join(__dirname, "..", "extensions", "tiendaiq-widgets", "blocks", "pagina.liquid"), "utf8");
  assert.match(liquid, /tq_pagina\.section_page\.contractVersion == 1/);
  assert.match(liquid, /render 'tiq-product-information-v1'/);
  assert.ok(liquid.indexOf("section_page.contractVersion") < liquid.indexOf("tq_pagina.version == 1"));
});
