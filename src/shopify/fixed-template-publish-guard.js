"use strict";

const { gql } = require("../../shopify");
const { resolveStoredTemplate } = require("../domain/template-registry");
const { PINZA_PAGEPILOT_V1, PILOTO_PINZA_PAGEPILOT_V1 } = require("../domain/fixed-template-manifest");

// Pinza v1 renders Shopify's selected_or_first_available_variant and does not
// expose a picker. Publishing it for a catalog with several purchasable
// variants would make the storefront silently choose one for the buyer.
const PRODUCT_VARIANTS_QUERY = `query FixedTemplatePublishVariantCheck($id: ID!) {
  product(id: $id) {
    id
    variants(first: 2) {
      nodes { id availableForSale }
      pageInfo { hasNextPage }
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
  return [PINZA_PAGEPILOT_V1, PILOTO_PINZA_PAGEPILOT_V1].some(
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
  const hasMoreVariants = product.variants?.pageInfo?.hasNextPage === true;
  const available = variants.filter((variant) => variant?.availableForSale === true);
  if (hasMoreVariants || available.length !== 1) {
    throw new FixedTemplatePublishError(
      "La plantilla Pinza sólo puede publicarse con exactamente una variante disponible; elegí un producto simple o usá una plantilla con selector de variantes"
    );
  }

  return Object.freeze({ productId, variantId: String(available[0].id) });
}

module.exports = Object.freeze({
  PRODUCT_VARIANTS_QUERY,
  FixedTemplatePublishError,
  isPinzaTemplate,
  productIdFromPage,
  assertFixedTemplatePublishable
});
