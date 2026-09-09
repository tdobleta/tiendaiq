"use strict";

const { gql } = require("../../shopify");
const { validatePage } = require("../section-pipeline/page-pipeline");

const PRODUCT_QUERY = `query SectionPagePublishCheck($id: ID!) {
  product(id: $id) {
    id
    variants(first: 100) { nodes { id } }
  }
}`;

class SectionPagePublishError extends Error {
  constructor(message) {
    super(message);
    this.name = "SectionPagePublishError";
    this.code = "SECTION_PAGE_NOT_PUBLISHABLE";
    this.status = 422;
    this.nonRetryable = true;
  }
}

function sectionPageProjection(data) {
  const page = validatePage(data?.section_page);
  const durableProductId = String(data?.fuente?.shopify_product_id || "");
  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(durableProductId) || page.productId !== durableProductId) {
    throw new SectionPagePublishError("La página por secciones no coincide con su producto Shopify");
  }
  return {
    contractVersion: page.contractVersion,
    productId: page.productId,
    sections: page.sections
  };
}

async function assertSectionPagePublishable(data, session, { signal, query = gql } = {}) {
  if (!data?.section_page) return null;
  const page = sectionPageProjection(data);
  const result = await query(PRODUCT_QUERY, { id: page.productId }, session, { signal });
  if (!result?.product || result.product.id !== page.productId) {
    throw new SectionPagePublishError("No se pudo confirmar el producto Shopify de esta página");
  }
  const liveVariants = new Set((result.product.variants?.nodes || []).map((variant) => String(variant.id)));
  if (liveVariants.size === 0) throw new SectionPagePublishError("El producto necesita al menos una variante para publicarse");
  for (const section of page.sections) {
    for (const block of section.instance.blocks || []) {
      if (block.binding?.variantId && !liveVariants.has(String(block.binding.variantId))) {
        throw new SectionPagePublishError("Una opción de compra apunta a una variante que ya no existe");
      }
    }
  }
  return Object.freeze({ productId: page.productId, variantCount: liveVariants.size });
}

module.exports = Object.freeze({
  PRODUCT_QUERY,
  SectionPagePublishError,
  assertSectionPagePublishable,
  sectionPageProjection
});
