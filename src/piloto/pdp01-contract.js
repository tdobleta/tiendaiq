"use strict";

// Piloto 01 is intentionally a narrow content contract.  The model never
// produces HTML, catalog values, arbitrary media URLs, prices or discounts.
const crypto = require("crypto");

const MONEY_OR_PERCENT = /(?:[$€£¥]|\b(?:ars|usd|eur|d[oó]lares?|pesos?)\b|\d+(?:[.,]\d+)?\s*%)/iu;
const GID = {
  product: /^gid:\/\/shopify\/Product\/\d+$/,
  media: /^gid:\/\/shopify\/MediaImage\/\d+$/,
  variant: /^gid:\/\/shopify\/ProductVariant\/\d+$/
};

class Pdp01ValidationError extends Error {
  constructor(errors) {
    super(`El documento Piloto 01 no es válido: ${errors.join("; ")}`);
    this.name = "Pdp01ValidationError";
    this.code = "PILOTO_PDP_01_INVALID";
    this.status = 422;
  }
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function plainObject(value) { return value && typeof value === "object" && !Array.isArray(value); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (plainObject(value)) return Object.keys(value).sort().reduce((out, key) => ({ ...out, [key]: canonical(value[key]) }), {});
  return value;
}
function hashSource(sourceFields) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(sourceFields))).digest("hex");
}
function sourceFieldsFromProduct(product) {
  return {
    product_gid: product.id,
    title: product.title || "Producto",
    description: product.description || "",
    vendor: product.vendor || "",
    product_type: product.productType || "",
    options: (product.options || []).map(({ name, values }) => ({ name, values: values || [] })),
    media_ids: (product.media?.edges || []).map(({ node }) => node).filter((media) => media.image?.url).map((media) => media.id),
    variants: (product.variants?.edges || []).map(({ node }) => ({ id: node.id, title: node.title || "Variante" }))
  };
}
function assertKeys(value, allowed, where, errors) {
  if (!plainObject(value)) { errors.push(`${where} debe ser un objeto`); return; }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${where}.${key} no pertenece al contrato`);
}
function text(value, where, errors, max = 600) {
  if (typeof value !== "string" || !value.trim() || value.length > max) errors.push(`${where} debe ser texto de hasta ${max} caracteres`);
  if (typeof value === "string" && MONEY_OR_PERCENT.test(value)) errors.push(`${where} contiene un importe o porcentaje congelado`);
}
function validateEvidence(evidence, origin, errors) {
  assertKeys(evidence, ["rating", "testimonial", "guarantee"], "evidence", errors);
  for (const [name, item] of Object.entries(evidence || {})) {
    if (!plainObject(item) || !plainObject(item.source) || !item.source.kind || !item.source.reference) errors.push(`evidence.${name} necesita una fuente verificable`);
    if (origin === "ai" && item?.source?.kind === "declarado_por_merchant") errors.push(`evidence.${name} no puede ser declarada por la IA`);
  }
}
function sanitizeEvidence(document, origin) {
  for (const [key, item] of Object.entries(document.evidence || {})) {
    if (!plainObject(item?.source) || !item.source.kind || !item.source.reference || (origin === "ai" && item.source.kind === "declarado_por_merchant")) delete document.evidence[key];
  }
}
function validatePdp01(document, { origin = "ai" } = {}) {
  const value = clone(document);
  const errors = [];
  assertKeys(value, ["contract_version", "template", "source_fields", "source_hash", "content", "evidence"], "documento", errors);
  if (value.contract_version !== 1 || value.template !== "piloto-pdp-01") errors.push("la versión o plantilla no coincide con Piloto 01");
  const source = value.source_fields;
  assertKeys(source, ["product_gid", "title", "description", "vendor", "product_type", "options", "media_ids", "variants"], "source_fields", errors);
  if (!GID.product.test(String(source?.product_gid || ""))) errors.push("source_fields.product_gid no es un producto Shopify válido");
  if (!Array.isArray(source?.media_ids) || !source.media_ids.every((id) => GID.media.test(String(id)))) errors.push("source_fields.media_ids no es válido");
  if (!Array.isArray(source?.variants) || !source.variants.length || !source.variants.every((variant) => GID.variant.test(String(variant?.id || "")))) errors.push("source_fields.variants no es válido");
  if (value.source_hash !== hashSource(source)) errors.push("source_hash no coincide con la fuente de verdad");
  const content = value.content;
  assertKeys(content, ["hero", "offer", "why", "timeline", "faq", "media"], "content", errors);
  const requiredSections = ["hero", "offer", "why", "timeline", "faq", "media"];
  for (const section of requiredSections) if (!plainObject(content?.[section])) errors.push(`content.${section} es obligatorio`);
  assertKeys(content?.hero, ["claim", "bullets"], "content.hero", errors);
  assertKeys(content?.offer, ["heading", "packs", "accordions"], "content.offer", errors);
  assertKeys(content?.why, ["eyebrow", "heading", "body", "points"], "content.why", errors);
  assertKeys(content?.timeline, ["heading", "intro", "steps"], "content.timeline", errors);
  assertKeys(content?.faq, ["heading", "items"], "content.faq", errors);
  assertKeys(content?.media, ["hero_media_id", "comparison_media_id", "community_media_id", "gallery_media_ids"], "content.media", errors);
  text(content?.hero?.claim, "content.hero.claim", errors);
  if (!Array.isArray(content?.hero?.bullets) || content.hero.bullets.length < 2 || content.hero.bullets.length > 4) errors.push("content.hero.bullets debe tener entre 2 y 4 elementos");
  else content.hero.bullets.forEach((item, index) => text(item, `content.hero.bullets[${index}]`, errors));
  text(content?.offer?.heading, "content.offer.heading", errors);
  if (!Array.isArray(content?.offer?.packs) || !content.offer.packs.length) errors.push("content.offer.packs es obligatorio");
  const knownVariants = new Set((source?.variants || []).map((variant) => variant.id));
  for (const pack of content?.offer?.packs || []) {
    assertKeys(pack, ["id", "label", "subtitle", "quantity", "mechanism", "variant_id", "badge"], "content.offer.pack", errors);
    if (!knownVariants.has(pack?.variant_id)) errors.push("un pack referencia una variante que no pertenece al producto");
    if (!["single_variant", "multi_quantity"].includes(pack?.mechanism)) errors.push("el mecanismo de un pack no está permitido");
    if (!Number.isInteger(pack?.quantity) || pack.quantity < 1 || pack.quantity > 100) errors.push("la cantidad del pack no es válida");
    text(pack?.label, "content.offer.pack.label", errors); text(pack?.subtitle, "content.offer.pack.subtitle", errors);
  }
  for (const key of ["eyebrow", "heading", "body"]) text(content?.why?.[key], `content.why.${key}`, errors);
  if (!Array.isArray(content?.why?.points) || content.why.points.length < 2) errors.push("content.why.points es obligatorio");
  else content.why.points.forEach((item, index) => text(item, `content.why.points[${index}]`, errors));
  for (const key of ["heading", "intro"]) text(content?.timeline?.[key], `content.timeline.${key}`, errors);
  if (!Array.isArray(content?.timeline?.steps) || content.timeline.steps.length < 2) errors.push("content.timeline.steps es obligatorio");
  else content.timeline.steps.forEach((step, index) => ["label", "heading", "body"].forEach((key) => text(step?.[key], `content.timeline.steps[${index}].${key}`, errors)));
  text(content?.faq?.heading, "content.faq.heading", errors);
  if (!Array.isArray(content?.faq?.items) || content.faq.items.length < 3) errors.push("content.faq.items es obligatorio");
  else content.faq.items.forEach((item, index) => { text(item?.question, `content.faq.items[${index}].question`, errors); text(item?.answer, `content.faq.items[${index}].answer`, errors, 2000); });
  const knownMedia = new Set(source?.media_ids || []);
  for (const [slot, id] of Object.entries(content?.media || {})) {
    if (slot === "gallery_media_ids") { if (!Array.isArray(id) || !id.every((mediaId) => knownMedia.has(mediaId))) errors.push("la galería referencia medios ajenos al producto"); }
    else if (!knownMedia.has(id)) errors.push(`content.media.${slot} no pertenece al producto`);
  }
  sanitizeEvidence(value, origin); validateEvidence(value.evidence, origin, errors);
  if (errors.length) throw new Pdp01ValidationError(errors);
  return value;
}
function storefrontProjection(document) {
  const valid = validatePdp01(document, { origin: "merchant" });
  return { contract_version: valid.contract_version, template: valid.template, content: valid.content, evidence: valid.evidence };
}
module.exports = Object.freeze({ Pdp01ValidationError, hashSource, sourceFieldsFromProduct, validatePdp01, storefrontProjection });
