"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FixedTemplatePublishError,
  assertFixedTemplatePublishable
} = require("../src/shopify/fixed-template-publish-guard");

function pinzaData(productId = "gid://shopify/Product/42") {
  return {
    global: { template: { id: "tiendaiq/pinza-pagepilot", version: 1 } },
    fuente: { shopify_product_id: productId }
  };
}

function productResponse({ variants, hasNextPage = false, id = "gid://shopify/Product/42" }) {
  return { product: { id, variants: { nodes: variants, pageInfo: { hasNextPage } } } };
}

test("Pinza permite publicar productos con variantes porque el renderer ofrece selector", async () => {
  const result = await assertFixedTemplatePublishable(pinzaData(), {}, {
    async query(_query, variables) {
      assert.deepEqual(variables, { id: "gid://shopify/Product/42" });
      return productResponse({ variants: [{ id: "gid://shopify/ProductVariant/7", availableForSale: true }] });
    }
  });
  assert.deepEqual(result, { productId: "gid://shopify/Product/42", variantId: "gid://shopify/ProductVariant/7" });
});

test("Pinza falla cerrado sólo cuando Shopify no entrega una variante", async () => {
  const rejected = [
    productResponse({ variants: [] })
  ];
  for (const response of rejected) {
    await assert.rejects(
      assertFixedTemplatePublishable(pinzaData(), {}, { async query() { return response; } }),
      (error) => error instanceof FixedTemplatePublishError && error.status === 422 && error.nonRetryable === true
    );
  }
});

test("Pinza falla cerrado si el producto durable no es un GID canónico", async () => {
  await assert.rejects(
    assertFixedTemplatePublishable(pinzaData("42"), {}, { async query() { throw new Error("no debe consultar Shopify"); } }),
    (error) => error instanceof FixedTemplatePublishError && error.code === "FIXED_TEMPLATE_VARIANT_SELECTION_REQUIRED"
  );
});

test("las demás plantillas no consultan Shopify ni cambian su publicación", async () => {
  const data = { global: { estilo: "clasico" }, fuente: { shopify_product_id: "gid://shopify/Product/42" } };
  const result = await assertFixedTemplatePublishable(data, {}, { async query() { throw new Error("no debe llamar"); } });
  assert.equal(result, null);
});
