"use strict";

const { gql } = require("../../shopify");
const { validatePage } = require("../section-pipeline/page-pipeline");

const PRODUCT_QUERY = `query SectionPagePublishCheck($id: ID!) {
  product(id: $id) {
    id
    title
    media(first: 100) {
      nodes {
        id
        ... on MediaImage { image { url } }
      }
      pageInfo { hasNextPage endCursor }
    }
    variants(first: 100) { nodes { id } pageInfo { hasNextPage endCursor } }
  }
}`;

const CONNECTION_PAGE_QUERY = `query SectionPageConnectionPage($id: ID!, $mediaAfter: String, $variantsAfter: String) {
  product(id: $id) {
    media(first: 100, after: $mediaAfter) { nodes { id } pageInfo { hasNextPage endCursor } }
    variants(first: 100, after: $variantsAfter) { nodes { id } pageInfo { hasNextPage endCursor } }
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
  const snapshot = data.section_page.productSnapshot || {};
  const result = await query(PRODUCT_QUERY, { id: page.productId }, session, { signal });
  if (!result?.product || result.product.id !== page.productId) {
    throw new SectionPagePublishError("No se pudo confirmar el producto Shopify de esta página");
  }
  if (snapshot.title && result.product.title && String(snapshot.title).trim() !== String(result.product.title).trim()) {
    throw new SectionPagePublishError("La vista previa no coincide con el título actual del producto Shopify");
  }
  const liveMediaNodes = [...(result.product.media?.nodes || [])];
  const liveVariantNodes = [...(result.product.variants?.nodes || [])];
  let mediaPage = result.product.media?.pageInfo || {};
  let variantsPage = result.product.variants?.pageInfo || {};
  while ((mediaPage.hasNextPage || variantsPage.hasNextPage) && (mediaPage.endCursor || variantsPage.endCursor)) {
    const next = await query(CONNECTION_PAGE_QUERY, {
      id: page.productId,
      mediaAfter: mediaPage.hasNextPage ? mediaPage.endCursor : null,
      variantsAfter: variantsPage.hasNextPage ? variantsPage.endCursor : null
    }, session, { signal });
    const media = next.product?.media;
    const variants = next.product?.variants;
    liveMediaNodes.push(...(media?.nodes || []));
    liveVariantNodes.push(...(variants?.nodes || []));
    mediaPage = media?.pageInfo || {};
    variantsPage = variants?.pageInfo || {};
  }
  const snapshotMedia = Array.isArray(snapshot.media) ? snapshot.media.filter((item) => item?.id) : [];
  const liveMedia = new Set(liveMediaNodes.map((item) => String(item?.id || "")).filter(Boolean));
  if (snapshotMedia.length && liveMedia.size && snapshotMedia.some((item) => !liveMedia.has(String(item.id)))) {
    throw new SectionPagePublishError("La vista previa contiene imágenes que ya no pertenecen al producto Shopify");
  }
  const liveVariants = new Set(liveVariantNodes.map((variant) => String(variant.id)));
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
