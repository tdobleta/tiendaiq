"use strict";

const productInformation = require("./product-information-v1");
const { SectionContractError, validateInstance } = require("./section-contract");

const REGISTRY = new Map([[`${productInformation.id}@${productInformation.version}`, productInformation]]);

function connection(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.nodes)) return value.nodes;
  if (Array.isArray(value?.edges)) return value.edges.map((edge) => edge?.node).filter(Boolean);
  return [];
}

function productSnapshot(product = {}, urls = {}) {
  const media = connection(product.media).map((item) => ({
    id: item.id || null,
    url: item.image?.url || item.preview?.image?.url || item.url || item.src || urls[item.id] || "",
    alt: item.alt || item.altText || product.title || ""
  })).filter((item) => item.url);
  const variants = connection(product.variants).map((variant) => ({
    id: variant.id,
    title: variant.title || "Variante",
    price: variant.price ?? "0",
    compareAtPrice: variant.compareAtPrice ?? null,
    available: variant.available !== false && variant.availableForSale !== false
  }));
  return {
    id: product.id || null,
    title: product.title || product.titulo || "Producto",
    description: product.description || product.descripcion || "",
    vendor: product.vendor || "",
    url: product.onlineStoreUrl || "#",
    media,
    variants
  };
}

function sectionTree(page) {
  return (page.sections || []).map((section, index) => ({
    id: section.id,
    label: section.label,
    position: index + 1,
    blockCount: section.instance.blocks.length,
    section: { id: section.definition.id, version: section.definition.version }
  }));
}

function createProductPage({ product, research = {}, urls = {} }) {
  const definition = productInformation;
  const instance = definition.adapt(product, research);
  const page = {
    contractVersion: 1,
    productId: String(product?.id || product?.productId || ""),
    productSnapshot: productSnapshot(product, urls),
    evidence: {
      visualObservations: Array.isArray(research.visualObservations) ? research.visualObservations : [],
      verifiedClaims: Array.isArray(research.claims) ? research.claims.filter((claim) => claim?.verified === true) : []
    },
    sections: [{
      id: "section-product-information",
      label: definition.schema.name,
      definition: { id: definition.id, version: definition.version, sourceSha256: definition.sourceSha256 },
      instance
    }]
  };
  return Object.freeze({ ...page, tree: sectionTree(page) });
}

function resolveSection(descriptor) {
  return REGISTRY.get(`${descriptor?.id}@${descriptor?.version}`) || null;
}

function validatePage(candidate) {
  if (!candidate || candidate.contractVersion !== 1 || !Array.isArray(candidate.sections)) {
    throw new SectionContractError("La página de secciones no cumple el contrato v1");
  }
  const ids = new Set();
  const sections = candidate.sections.map((section) => {
    if (!section?.id || ids.has(section.id)) throw new SectionContractError("La página contiene secciones sin identidad única");
    ids.add(section.id);
    const definition = resolveSection(section.definition);
    if (!definition || section.definition.sourceSha256 !== definition.sourceSha256) {
      throw new SectionContractError(`La versión visual de ${section.label || section.id} no coincide con el registro`);
    }
    return { ...section, instance: validateInstance({ definition, instance: section.instance }) };
  });
  const page = { ...candidate, sections };
  return Object.freeze({ ...page, tree: sectionTree(page) });
}

function editorRegistry() {
  return [...REGISTRY.values()].map((definition) => ({
    id: definition.id,
    version: definition.version,
    name: definition.schema.name,
    sourceSha256: definition.sourceSha256,
    editor: definition.editor,
    seed: definition.seed
  }));
}

module.exports = Object.freeze({ createProductPage, editorRegistry, productSnapshot, resolveSection, sectionTree, validatePage });
