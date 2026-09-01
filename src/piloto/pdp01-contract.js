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

// This is the only shape the model is allowed to produce. Commerce belongs to
// Shopify, therefore packs, variants, availability and media are deliberately
// absent here and are assembled from source_fields by generate-pdp01.js.
//
// Anthropic's structured-output API does not accept array-cardinality
// keywords. The domain validator below remains the authority for every
// minimum and maximum requirement after the provider has returned its JSON.
const COPY_TEXT = { type: "string", minLength: 1, maxLength: 600 };
const COPY_LONG_TEXT = { type: "string", minLength: 1, maxLength: 2000 };
const FAQ_ITEM = {
  type: "object", additionalProperties: false, required: ["question", "answer"],
  properties: { question: COPY_TEXT, answer: COPY_LONG_TEXT }
};
const TIMELINE_STEP = {
  type: "object", additionalProperties: false, required: ["label", "heading", "body"],
  properties: { label: COPY_TEXT, heading: COPY_TEXT, body: COPY_LONG_TEXT }
};
const STORY_CARD = {
  type: "object", additionalProperties: false, required: ["title", "body", "product_note"],
  properties: { title: COPY_TEXT, body: COPY_LONG_TEXT, product_note: COPY_TEXT }
};
const PDP01_COPY_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hero", "offer", "quick", "why", "stories", "timeline", "faq", "closing", "newsletter"],
  properties: {
    hero: {
      type: "object", additionalProperties: false, required: ["claim", "bullets"],
      properties: { claim: COPY_TEXT, bullets: { type: "array", items: COPY_TEXT } }
    },
    offer: {
      type: "object", additionalProperties: false, required: ["heading"],
      properties: { heading: COPY_TEXT }
    },
    quick: {
      type: "object", additionalProperties: false, required: ["items"],
      properties: { items: { type: "array", items: FAQ_ITEM } }
    },
    why: {
      type: "object", additionalProperties: false, required: ["eyebrow", "heading", "body", "points"],
      properties: {
        eyebrow: COPY_TEXT, heading: COPY_TEXT, body: COPY_TEXT,
        points: { type: "array", items: COPY_TEXT }
      }
    },
    stories: {
      type: "object", additionalProperties: false, required: ["heading", "intro", "cards"],
      properties: {
        heading: COPY_TEXT, intro: COPY_TEXT,
        cards: { type: "array", items: STORY_CARD }
      }
    },
    timeline: {
      type: "object", additionalProperties: false, required: ["heading", "intro", "steps"],
      properties: {
        heading: COPY_TEXT, intro: COPY_TEXT,
        steps: {
          type: "array",
          items: TIMELINE_STEP
        }
      }
    },
    faq: {
      type: "object", additionalProperties: false, required: ["heading", "intro", "items"],
      properties: {
        heading: COPY_TEXT, intro: COPY_TEXT, items: { type: "array", items: FAQ_ITEM }
      }
    },
    closing: {
      type: "object", additionalProperties: false, required: ["eyebrow", "heading", "body", "secondary_body"],
      properties: { eyebrow: COPY_TEXT, heading: COPY_TEXT, body: COPY_LONG_TEXT, secondary_body: COPY_LONG_TEXT }
    },
    newsletter: {
      type: "object", additionalProperties: false, required: ["heading", "body"],
      properties: { heading: COPY_TEXT, body: COPY_TEXT }
    }
  }
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
function validatePdp01Copy(copy, { requireComplete = true } = {}) {
  const errors = [];
  const sections = ["hero", "offer", "quick", "why", "stories", "timeline", "faq", "closing", "newsletter"];
  assertKeys(copy, sections, "copy", errors);
  for (const section of sections) if (requireComplete && !plainObject(copy?.[section])) errors.push(`copy.${section} es obligatorio`);
  const present = (section) => plainObject(copy?.[section]);
  if (present("hero")) {
    assertKeys(copy.hero, ["claim", "bullets"], "copy.hero", errors);
    text(copy.hero.claim, "copy.hero.claim", errors);
    if (!Array.isArray(copy.hero.bullets) || copy.hero.bullets.length < 2 || copy.hero.bullets.length > 4) errors.push("copy.hero.bullets debe tener entre 2 y 4 elementos");
    else copy.hero.bullets.forEach((item, index) => text(item, `copy.hero.bullets[${index}]`, errors));
  }
  if (present("offer")) { assertKeys(copy.offer, ["heading"], "copy.offer", errors); text(copy.offer.heading, "copy.offer.heading", errors); }
  const factList = (section, min, max) => {
    if (!present(section)) return;
    assertKeys(copy[section], ["items"], `copy.${section}`, errors);
    const items = copy[section].items;
    if (!Array.isArray(items) || items.length < min || items.length > max) { errors.push(`copy.${section}.items debe tener entre ${min} y ${max} elementos`); return; }
    items.forEach((item, index) => {
      assertKeys(item, ["question", "answer"], `copy.${section}.items[${index}]`, errors);
      text(item?.question, `copy.${section}.items[${index}].question`, errors);
      text(item?.answer, `copy.${section}.items[${index}].answer`, errors, 2000);
    });
  };
  factList("quick", 2, 4);
  if (present("why")) {
    assertKeys(copy.why, ["eyebrow", "heading", "body", "points"], "copy.why", errors);
    for (const key of ["eyebrow", "heading", "body"]) text(copy.why[key], `copy.why.${key}`, errors);
    if (!Array.isArray(copy.why.points) || copy.why.points.length < 2 || copy.why.points.length > 4) errors.push("copy.why.points debe tener entre 2 y 4 elementos");
    else copy.why.points.forEach((item, index) => text(item, `copy.why.points[${index}]`, errors));
  }
  if (present("stories")) {
    assertKeys(copy.stories, ["heading", "intro", "cards"], "copy.stories", errors);
    for (const key of ["heading", "intro"]) text(copy.stories[key], `copy.stories.${key}`, errors);
    if (!Array.isArray(copy.stories.cards) || copy.stories.cards.length < 3 || copy.stories.cards.length > 5) errors.push("copy.stories.cards debe tener entre 3 y 5 elementos");
    else copy.stories.cards.forEach((card, index) => {
      assertKeys(card, ["title", "body", "product_note"], `copy.stories.cards[${index}]`, errors);
      for (const key of ["title", "body", "product_note"]) text(card?.[key], `copy.stories.cards[${index}].${key}`, errors, key === "body" ? 2000 : 600);
    });
  }
  if (present("timeline")) {
    assertKeys(copy.timeline, ["heading", "intro", "steps"], "copy.timeline", errors);
    for (const key of ["heading", "intro"]) text(copy.timeline[key], `copy.timeline.${key}`, errors);
    if (!Array.isArray(copy.timeline.steps) || copy.timeline.steps.length < 2 || copy.timeline.steps.length > 4) errors.push("copy.timeline.steps debe tener entre 2 y 4 elementos");
    else copy.timeline.steps.forEach((step, index) => {
      assertKeys(step, ["label", "heading", "body"], `copy.timeline.steps[${index}]`, errors);
      for (const key of ["label", "heading", "body"]) text(step?.[key], `copy.timeline.steps[${index}].${key}`, errors, key === "body" ? 2000 : 600);
    });
  }
  if (present("faq")) {
    assertKeys(copy.faq, ["heading", "intro", "items"], "copy.faq", errors);
    text(copy.faq.heading, "copy.faq.heading", errors);
    if (requireComplete || Object.hasOwn(copy.faq, "intro")) text(copy.faq.intro, "copy.faq.intro", errors);
    if (!Array.isArray(copy.faq.items) || copy.faq.items.length < 3 || copy.faq.items.length > 8) errors.push("copy.faq.items debe tener entre 3 y 8 elementos");
    else copy.faq.items.forEach((item, index) => {
      assertKeys(item, ["question", "answer"], `copy.faq.items[${index}]`, errors);
      text(item?.question, `copy.faq.items[${index}].question`, errors); text(item?.answer, `copy.faq.items[${index}].answer`, errors, 2000);
    });
  }
  if (present("closing")) {
    assertKeys(copy.closing, ["eyebrow", "heading", "body", "secondary_body"], "copy.closing", errors);
    for (const key of ["eyebrow", "heading", "body", "secondary_body"]) text(copy.closing[key], `copy.closing.${key}`, errors, key.includes("body") ? 2000 : 600);
  }
  if (present("newsletter")) {
    assertKeys(copy.newsletter, ["heading", "body"], "copy.newsletter", errors);
    text(copy.newsletter.heading, "copy.newsletter.heading", errors); text(copy.newsletter.body, "copy.newsletter.body", errors);
  }
  if (errors.length) throw new Pdp01ValidationError(errors);
  return clone(copy);
}
// La evidencia no es copy que pueda inventar la IA. Es un conjunto de slots
// visuales que el merchant puede completar después con una fuente rastreable.
// Mientras tanto el renderer conserva la tarjeta y la convierte en una pieza
// editorial neutra; nunca la hace pasar por una reseña o una garantía real.
function validEvidenceSource(source) {
  return plainObject(source) &&
    ["shopify_policy", "review_provider", "merchant_file", "declarado_por_merchant"].includes(source.kind) &&
    typeof source.reference === "string" && source.reference.trim().length > 0 && source.reference.length <= 500;
}
function evidenceText(value, where, errors, max = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) errors.push(`${where} debe ser texto de hasta ${max} caracteres`);
  if (typeof value === "string" && MONEY_OR_PERCENT.test(value)) errors.push(`${where} contiene un importe o porcentaje congelado`);
}
function validateEvidence(evidence, origin, errors, knownMedia = new Set()) {
  assertKeys(evidence, ["rating", "testimonial", "guarantee", "offer", "comparison"], "evidence", errors);
  for (const [name, item] of Object.entries(evidence || {})) {
    const allowed = {
      rating: ["source", "value", "count"],
      testimonial: ["source", "text", "author", "media_id"],
      guarantee: ["source", "title", "body"],
      offer: ["source", "ends_at", "label"],
      comparison: ["source", "left_label", "right_label"]
    }[name] || [];
    assertKeys(item, allowed, `evidence.${name}`, errors);
    assertKeys(item?.source, ["kind", "reference"], `evidence.${name}.source`, errors);
    if (!plainObject(item) || !validEvidenceSource(item.source)) {
      errors.push(`evidence.${name} necesita una fuente verificable`);
      continue;
    }
    if (origin === "ai" && item.source.kind === "declarado_por_merchant") errors.push(`evidence.${name} no puede ser declarada por la IA`);
    if (name === "rating") {
      if (!Number.isFinite(Number(item.value)) || Number(item.value) < 0 || Number(item.value) > 5) errors.push("evidence.rating.value debe estar entre 0 y 5");
      if (!Number.isInteger(item.count) || item.count < 1 || item.count > 100000000) errors.push("evidence.rating.count debe ser un entero positivo");
    }
    if (name === "testimonial") {
      if (Object.hasOwn(item, "text")) evidenceText(item.text, "evidence.testimonial.text", errors);
      if (Object.hasOwn(item, "author")) evidenceText(item.author, "evidence.testimonial.author", errors, 160);
      if (Object.hasOwn(item, "media_id") && !knownMedia.has(item.media_id)) errors.push("evidence.testimonial.media_id no pertenece al producto");
    }
    if (name === "guarantee") {
      if (Object.hasOwn(item, "title")) evidenceText(item.title, "evidence.guarantee.title", errors, 300);
      if (Object.hasOwn(item, "body")) evidenceText(item.body, "evidence.guarantee.body", errors);
    }
    if (name === "offer") {
      if (typeof item.ends_at !== "string" || Number.isNaN(Date.parse(item.ends_at))) errors.push("evidence.offer.ends_at debe ser una fecha válida");
      if (Object.hasOwn(item, "label")) evidenceText(item.label, "evidence.offer.label", errors, 160);
    }
    if (name === "comparison") {
      if (Object.hasOwn(item, "left_label")) evidenceText(item.left_label, "evidence.comparison.left_label", errors, 120);
      if (Object.hasOwn(item, "right_label")) evidenceText(item.right_label, "evidence.comparison.right_label", errors, 120);
    }
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
  assertKeys(content, ["hero", "offer", "quick", "why", "stories", "timeline", "faq", "closing", "newsletter", "media"], "content", errors);
  const requiredSections = ["hero", "offer", "why", "timeline", "faq", "media"];
  for (const section of requiredSections) if (!plainObject(content?.[section])) errors.push(`content.${section} es obligatorio`);
  assertKeys(content?.hero, ["claim", "bullets"], "content.hero", errors);
  assertKeys(content?.offer, ["heading", "packs"], "content.offer", errors);
  assertKeys(content?.why, ["eyebrow", "heading", "body", "points"], "content.why", errors);
  assertKeys(content?.timeline, ["heading", "intro", "steps"], "content.timeline", errors);
  assertKeys(content?.faq, ["heading", "intro", "items"], "content.faq", errors);
  if (plainObject(content?.quick)) assertKeys(content.quick, ["items"], "content.quick", errors);
  if (plainObject(content?.stories)) assertKeys(content.stories, ["heading", "intro", "cards"], "content.stories", errors);
  if (plainObject(content?.closing)) assertKeys(content.closing, ["eyebrow", "heading", "body", "secondary_body"], "content.closing", errors);
  if (plainObject(content?.newsletter)) assertKeys(content.newsletter, ["heading", "body"], "content.newsletter", errors);
  assertKeys(content?.media, ["hero_media_id", "comparison_media_id", "community_media_id", "story_media_ids", "gallery_media_ids"], "content.media", errors);
  try {
    validatePdp01Copy({ hero: content?.hero, offer: { heading: content?.offer?.heading }, quick: content?.quick, why: content?.why, stories: content?.stories, timeline: content?.timeline, faq: content?.faq, closing: content?.closing, newsletter: content?.newsletter }, { requireComplete: false });
  } catch (error) {
    if (error instanceof Pdp01ValidationError) errors.push(...error.message.replace(/^El documento Piloto 01 no es válido:\s*/, "").split("; "));
    else throw error;
  }
  if (!Array.isArray(content?.offer?.packs) || !content.offer.packs.length) errors.push("content.offer.packs es obligatorio");
  const knownVariants = new Set((source?.variants || []).map((variant) => variant.id));
  for (const pack of content?.offer?.packs || []) {
    assertKeys(pack, ["id", "label", "subtitle", "quantity", "mechanism", "variant_id"], "content.offer.pack", errors);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(pack?.id || ""))) errors.push("el identificador del pack no es válido");
    if (!knownVariants.has(pack?.variant_id)) errors.push("un pack referencia una variante que no pertenece al producto");
    if (!["single_variant", "multi_quantity"].includes(pack?.mechanism)) errors.push("el mecanismo de un pack no está permitido");
    if (!Number.isInteger(pack?.quantity) || pack.quantity < 1 || pack.quantity > 100) errors.push("la cantidad del pack no es válida");
    text(pack?.label, "content.offer.pack.label", errors); text(pack?.subtitle, "content.offer.pack.subtitle", errors);
  }
  const knownMedia = new Set(source?.media_ids || []);
  if (!knownMedia.has(content?.media?.hero_media_id)) errors.push("content.media.hero_media_id no pertenece al producto");
  if (!Array.isArray(content?.media?.gallery_media_ids) || !content.media.gallery_media_ids.length || !content.media.gallery_media_ids.every((mediaId) => knownMedia.has(mediaId))) errors.push("la galería referencia medios ajenos al producto");
  if (Object.hasOwn(content?.media || {}, "story_media_ids") && (!Array.isArray(content.media.story_media_ids) || !content.media.story_media_ids.every((mediaId) => knownMedia.has(mediaId)))) errors.push("las tarjetas editoriales referencian medios ajenos al producto");
  for (const slot of ["comparison_media_id", "community_media_id"]) if (Object.hasOwn(content?.media || {}, slot) && !knownMedia.has(content.media[slot])) errors.push(`content.media.${slot} no pertenece al producto`);
  sanitizeEvidence(value, origin); validateEvidence(value.evidence, origin, errors, knownMedia);
  if (errors.length) throw new Pdp01ValidationError(errors);
  return value;
}
function storefrontProjection(document) {
  const valid = validatePdp01(document, { origin: "merchant" });
  return { contract_version: valid.contract_version, template: valid.template, content: valid.content, evidence: valid.evidence };
}
module.exports = Object.freeze({ PDP01_COPY_OUTPUT_SCHEMA, Pdp01ValidationError, hashSource, sourceFieldsFromProduct, validatePdp01Copy, validatePdp01, storefrontProjection });
