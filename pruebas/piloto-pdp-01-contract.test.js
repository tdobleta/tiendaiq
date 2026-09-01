"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PDP01_COPY_OUTPUT_SCHEMA, hashSource, validatePdp01, storefrontProjection } = require("../src/piloto/pdp01-contract");
const { copyFromModelJson, commerceFromSource, composePdp01Content } = require("../src/piloto/generate-pdp01");

function page() {
  const source_fields = {
    product_gid: "gid://shopify/Product/1", title: "Producto real", description: "Descripción", vendor: "Marca", product_type: "",
    options: [], media_ids: ["gid://shopify/MediaImage/10"], variants: [{ id: "gid://shopify/ProductVariant/11", title: "Única" }]
  };
  return {
    contract_version: 1, template: "piloto-pdp-01", source_fields, source_hash: hashSource(source_fields), evidence: {},
    content: {
      hero: { claim: "Una forma simple de sumarlo a tu rutina", bullets: ["Información clara para elegir", "Una experiencia directa"] },
      offer: { heading: "Opciones de compra", packs: [{ id: "unidad", label: "Una unidad", subtitle: "Para empezar", quantity: 1, mechanism: "multi_quantity", variant_id: "gid://shopify/ProductVariant/11" }] },
      why: { eyebrow: "Hecho para tu rutina", heading: "Una decisión clara", body: "Conocé el producto antes de elegirlo.", points: ["Detalles fáciles de consultar", "Una experiencia directa"] },
      timeline: { heading: "Tu recorrido", intro: "Una guía clara para empezar.", steps: [{ label: "Paso uno", heading: "Conocé el producto", body: "Revisá la información disponible." }, { label: "Paso dos", heading: "Elegí tu opción", body: "Seleccioná la presentación adecuada." }] },
      faq: { heading: "Preguntas frecuentes", items: [{ question: "¿Cómo elijo?", answer: "Revisá la información del producto." }, { question: "¿Qué incluye?", answer: "La presentación seleccionada." }, { question: "¿Dónde veo variantes?", answer: "En las opciones de compra." }] },
      media: { hero_media_id: "gid://shopify/MediaImage/10", gallery_media_ids: ["gid://shopify/MediaImage/10"] }
    }
  };
}

test("Piloto 01 elimina evidencia sin fuente antes de guardar", () => {
  const data = page(); data.evidence.testimonial = { text: "Excelente", author: "Alguien" };
  assert.equal(validatePdp01(data, { origin: "ai" }).evidence.testimonial, undefined);
});
test("Piloto 01 rechaza campos libres, importes y referencias ajenas", () => {
  const extra = page(); extra.content.hero.html = "<script>";
  assert.throws(() => validatePdp01(extra), /no pertenece al contrato/);
  const money = page(); money.content.hero.claim = "Ahorrás 20%";
  assert.throws(() => validatePdp01(money), /importe o porcentaje/);
  const foreign = page(); foreign.content.offer.packs[0].variant_id = "gid://shopify/ProductVariant/12";
  assert.throws(() => validatePdp01(foreign), /no pertenece al producto/);
});
test("la proyección de storefront nunca expone fuente ni hash", () => {
  const projection = storefrontProjection(page());
  assert.equal(projection.source_fields, undefined);
  assert.equal(projection.source_hash, undefined);
  assert.equal(projection.content.offer.packs[0].quantity, 1);
});
test("Piloto 01 arma packs y medios vivos desde Shopify, no desde la IA", () => {
  const source = page().source_fields;
  const copy = {
    hero: page().content.hero,
    offer: { heading: page().content.offer.heading },
    why: page().content.why,
    timeline: page().content.timeline,
    faq: page().content.faq
  };
  const content = composePdp01Content(copy, source);
  assert.deepEqual(content.offer.packs.map((pack) => pack.quantity), [1, 3, 5]);
  assert.deepEqual(content.offer.packs.map((pack) => pack.variant_id), [source.variants[0].id, source.variants[0].id, source.variants[0].id]);
  assert.equal(content.media.hero_media_id, source.media_ids[0]);
  assert.doesNotThrow(() => validatePdp01({ ...page(), content }));
});
test("Piloto 01 rechaza un sobre, campos extra y medios generados por la IA", () => {
  const copy = {
    hero: page().content.hero,
    offer: { heading: page().content.offer.heading },
    why: page().content.why,
    timeline: page().content.timeline,
    faq: page().content.faq
  };
  assert.deepEqual(copyFromModelJson(JSON.stringify(copy)), copy);
  assert.throws(() => copyFromModelJson(JSON.stringify({ content: copy })), /copy\.content no pertenece al contrato/);
  assert.throws(() => copyFromModelJson(JSON.stringify({ ...copy, media: {} })), /copy\.media no pertenece al contrato/);
});
test("el esquema estructurado deja sólo copy abierto a la IA", () => {
  assert.deepEqual(Object.keys(PDP01_COPY_OUTPUT_SCHEMA.properties).sort(), ["faq", "hero", "offer", "timeline", "why"]);
  assert.equal(PDP01_COPY_OUTPUT_SCHEMA.additionalProperties, false);
  assert.equal(PDP01_COPY_OUTPUT_SCHEMA.properties.offer.properties.packs, undefined);
  assert.deepEqual(commerceFromSource(page().source_fields).packs.map((pack) => pack.label), ["1 unidad", "3 unidades", "5 unidades"]);
});
test("el esquema enviado a Anthropic usa sólo mínimos de listas compatibles", () => {
  const invalidMinimum = [];
  function inspect(value, path = "schema") {
    if (!value || typeof value !== "object") return;
    if (value.type === "array" && value.minItems > 1) invalidMinimum.push(path);
    for (const [key, child] of Object.entries(value)) inspect(child, `${path}.${key}`);
  }
  inspect(PDP01_COPY_OUTPUT_SCHEMA);
  assert.deepEqual(invalidMinimum, []);

  // The stricter product requirement remains enforced after generation.
  const copy = { hero: { ...page().content.hero, bullets: ["Un único punto"] }, offer: { heading: "Opciones" }, why: page().content.why, timeline: page().content.timeline, faq: page().content.faq };
  assert.throws(() => copyFromModelJson(JSON.stringify(copy)), /copy\.hero\.bullets debe tener entre 2 y 4 elementos/);
});
