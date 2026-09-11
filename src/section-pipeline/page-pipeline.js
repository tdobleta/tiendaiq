"use strict";

const productInformation = require("./product-information-v1");
const imageWithText = require("./image-with-text-v1");
const imageWithTimeline = require("./image-with-timeline-v1");
const imageWithBenefits = require("./image-with-benefits-v1");
const testimonialsWithImages = require("./testimonials-with-images-v1");
const { resolvePageComposition } = require("./page-compositions");
const { SectionContractError, validateInstance } = require("./section-contract");
const { normalizePersistedCopySlots, persistCopySlots } = require("./copy-slots");

const DEFINITIONS = Object.freeze([productInformation, imageWithText, imageWithTimeline, imageWithBenefits, testimonialsWithImages]);
const REGISTRY = new Map(DEFINITIONS.map((definition) => [`${definition.id}@${definition.version}`, definition]));

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

function sectionDescriptor(definition) {
  return {
    id: definition.id,
    version: definition.version,
    sourceSha256: definition.sourceSha256
  };
}

function uniqueSectionId(definition, index) {
  return index === 0 ? "section-product-information" : `section-${definition.id}-${index}`;
}

function createProductPage({ product, research = {}, urls = {}, composition = null, generatedAt = null }) {
  const selectedComposition = composition == null
    ? [{ id: productInformation.id, version: productInformation.version, required: true }]
    : (Array.isArray(composition) ? composition : resolvePageComposition(composition));
  if (!selectedComposition.length) throw new SectionContractError("La composición necesita al menos una sección");

  const sections = selectedComposition.map((descriptor, index) => {
    const definition = resolveSection(descriptor);
    if (!definition) throw new SectionContractError(`La sección ${descriptor?.id || "solicitada"} no existe en el registro`);
    if (index === 0 && definition.id !== productInformation.id) {
      throw new SectionContractError("La composición debe comenzar con Información del producto");
    }
    return {
      id: uniqueSectionId(definition, index),
      label: definition.schema.name,
      definition: sectionDescriptor(definition),
      instance: definition.adapt(product, research)
    };
  });
  const persistedCopySlots = Object.hasOwn(research, "copy_slots_v1")
    ? persistCopySlots(research.copy_slots_v1, { generatedAt })
    : null;
  const page = {
    contractVersion: 1,
    revision: 0,
    productId: String(product?.id || product?.productId || ""),
    productSnapshot: productSnapshot(product, urls),
    evidence: {
      visualObservations: Array.isArray(research.visualObservations) ? research.visualObservations : [],
      verifiedClaims: Array.isArray(research.claims) ? research.claims.filter((claim) => claim?.verified === true) : []
    },
    sections,
    ...(persistedCopySlots ? { copy_slots_v1: persistedCopySlots } : {})
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
    if (!definition) {
      throw new SectionContractError(`La versión visual de ${section.label || section.id} no coincide con el registro`);
    }
    // Las páginas persistidas sobreviven a despliegues. Si una corrección de
    // Liquid conserva el mismo id/version y la instancia sigue siendo válida,
    // actualizamos la huella al registro vigente para que un borrador anterior
    // no quede inutilizable en preview, guardado o publicación. Los cambios de
    // contrato real siguen exigiendo una nueva version y nunca llegan aquí.
    const instance = validateInstance({ definition, instance: section.instance });
    return {
      ...section,
      definition: { ...section.definition, sourceSha256: definition.sourceSha256 },
      instance
    };
  });
  const page = {
    ...candidate,
    ...(Object.hasOwn(candidate, "copy_slots_v1")
      ? { copy_slots_v1: normalizePersistedCopySlots(candidate.copy_slots_v1) }
      : {}),
    sections
  };
  return Object.freeze({ ...page, tree: sectionTree(page) });
}

function editorRegistry() {
  return [...REGISTRY.values()].map((definition) => ({
    id: definition.id,
    version: definition.version,
    name: definition.schema.name,
    sourceSha256: definition.sourceSha256,
    editor: definition.editor,
    copySlots: definition.copySlots,
    contentSources: definition.contentSources,
    lockedFields: definition.lockedFields,
    seed: definition.seed,
    catalog: definition.catalog,
    capabilities: definition.capabilities
  }));
}

function instantiateSection(descriptor, product = {}, research = {}) {
  const definition = resolveSection(descriptor);
  if (!definition) throw new SectionContractError("La sección solicitada no existe en el registro");
  return definition.adapt(product, research);
}

module.exports = Object.freeze({ DEFINITIONS, createProductPage, editorRegistry, instantiateSection, productSnapshot, resolveSection, sectionTree, validatePage });
