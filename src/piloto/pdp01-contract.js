"use strict";

const crypto = require("crypto");
const Ajv = require("ajv/dist/2020");
const schema = require("./piloto-pdp-01.schema.json");

// El contrato usa `if/then/not` para packs. Ajv marca esos `required` anidados
// como aviso estricto aunque las propiedades estén declaradas en el objeto padre.
const ajv = new Ajv({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);
const MONEY_OR_PERCENT = /(?:[$€£¥]|\b(?:ars|usd|eur|d[oó]lares?|pesos?)\b|\d+(?:[.,]\d+)?\s*%)/iu;

class Pdp01ValidationError extends Error {
  constructor(errors) {
    super(`El documento piloto-pdp-01 no es válido: ${errors.join("; ")}`);
    this.name = "Pdp01ValidationError";
    this.errors = errors;
  }
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonical(value[key]);
      return result;
    }, {});
  }
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
    media_ids: (product.media?.edges || []).map((edge) => edge.node).filter((media) => media.image?.url).map((media) => media.id),
    variants: (product.variants?.edges || []).map(({ node }) => ({ id: node.id, title: node.title || "Variante" }))
  };
}

function walkStrings(value, path = "documento", errors = []) {
  if (typeof value === "string" && MONEY_OR_PERCENT.test(value)) errors.push(`${path} contiene un importe o porcentaje`);
  else if (Array.isArray(value)) value.forEach((item, index) => walkStrings(item, `${path}[${index}]`, errors));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => walkStrings(item, `${path}.${key}`, errors));
  return errors;
}

function dropUnprovenEvidence(document, { origin }) {
  const evidence = document.evidence || {};
  for (const [key, value] of Object.entries(evidence)) {
    if (!value?.source?.kind || !value.source.reference || (origin === "ai" && value.source.kind === "declarado_por_merchant")) delete evidence[key];
  }
}

function validatePdp01(document, { origin = "ai" } = {}) {
  const result = plain(document);
  dropUnprovenEvidence(result, { origin });
  const errors = [];
  if (!validateSchema(result)) errors.push(...validateSchema.errors.map((error) => `${error.instancePath || "/"} ${error.message}`));
  if (result.source_fields && result.source_hash && result.source_hash !== hashSource(result.source_fields)) errors.push("source_hash no coincide con la fuente de verdad");
  walkStrings(result.content, "content", errors);
  const knownMedia = new Set(result.source_fields?.media_ids || []);
  for (const [slot, mediaId] of Object.entries(result.content?.media || {})) {
    if (slot === "gallery_media_ids") {
      for (const id of mediaId || []) if (!knownMedia.has(id)) errors.push(`content.media.${slot} no pertenece al producto`);
    } else if (mediaId && !knownMedia.has(mediaId)) errors.push(`content.media.${slot} no pertenece al producto`);
  }
  const knownVariants = new Set((result.source_fields?.variants || []).map((variant) => variant.id));
  for (const pack of result.content?.offer?.packs || []) {
    if (pack.mechanism !== "bundle" && !knownVariants.has(pack.variant_id)) errors.push(`el pack ${pack.id} referencia una variante inexistente`);
    // Esta primera plantilla usa cantidades reales del mismo variant. Hasta que
    // un pack quede enlazado a una regla de descuento real de Shopify, jamás se
    // acepta una rebaja declarada en el JSON: evita promesas congeladas.
    if (pack.claimed_discount_pct != null) errors.push(`el pack ${pack.id} declara un descuento sin una regla de Shopify verificada`);
  }
  if (errors.length) throw new Pdp01ValidationError(errors);
  return result;
}

function storefrontProjection(document) {
  const safe = validatePdp01(document, { origin: "merchant" });
  return {
    contract_version: safe.contract_version,
    template: safe.template,
    content: safe.content,
    evidence: safe.evidence
  };
}

module.exports = { Pdp01ValidationError, hashSource, sourceFieldsFromProduct, validatePdp01, storefrontProjection };
