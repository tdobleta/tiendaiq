"use strict";

const { gql } = require("../../shopify");
const { resolveStoredTemplate } = require("../domain/template-registry");
const { PINZA_PAGEPILOT_V1, PILOTO_PINZA_PAGEPILOT_V1, PILOTO_PDP_01_V1 } = require("../domain/fixed-template-manifest");

// The fixed runtime renders the product's own variant list. The guard only
// verifies that the durable product reference is real before assigning its
// Shopify product template; choice and availability remain live storefront data.
const PRODUCT_VARIANTS_QUERY = `query FixedTemplatePublishVariantCheck($id: ID!) {
  product(id: $id) {
    id
    variants(first: 1) {
      nodes { id }
    }
  }
}`;

class FixedTemplatePublishError extends Error {
  constructor(message) {
    super(message);
    this.name = "FixedTemplatePublishError";
    this.code = "FIXED_TEMPLATE_VARIANT_SELECTION_REQUIRED";
    this.status = 422;
    this.nonRetryable = true;
  }
}

function isPinzaTemplate(data) {
  const template = resolveStoredTemplate(data?.global || {});
  return [PINZA_PAGEPILOT_V1, PILOTO_PINZA_PAGEPILOT_V1, PILOTO_PDP_01_V1].some(
    (candidate) => template?.id === candidate.id && template.version === candidate.version
  );
}

function productIdFromPage(data) {
  const productId = String(data?.fuente?.shopify_product_id || "");
  return /^gid:\/\/shopify\/Product\/\d+$/.test(productId) ? productId : null;
}

async function assertFixedTemplatePublishable(data, session, { signal, query = gql } = {}) {
  if (!isPinzaTemplate(data)) return null;

  const productId = productIdFromPage(data);
  if (!productId) {
    throw new FixedTemplatePublishError("La plantilla Pinza necesita un producto Shopify válido antes de publicarse");
  }

  const result = await query(PRODUCT_VARIANTS_QUERY, { id: productId }, session, { signal });
  const product = result?.product;
  if (!product || product.id !== productId) {
    throw new FixedTemplatePublishError("No se pudo confirmar el producto Shopify de esta plantilla antes de publicarla");
  }

  const variants = product.variants?.nodes || [];
  if (variants.length === 0) {
    throw new FixedTemplatePublishError(
      "La plantilla Pinza necesita al menos una variante Shopify antes de publicarse"
    );
  }

  return Object.freeze({ productId, variantId: String(variants[0].id) });
}

module.exports = Object.freeze({
  PRODUCT_VARIANTS_QUERY,
  FixedTemplatePublishError,
  isPinzaTemplate,
  productIdFromPage,
  assertFixedTemplatePublishable
});
