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
      quick: { items: [
        { question: "¿Qué información encuentro?", answer: "Podés revisar los detalles disponibles antes de elegir." },
        { question: "¿Cómo selecciono una opción?", answer: "Elegí la presentación que mejor se adapte a tu compra." }
      ] },
      why: { eyebrow: "Hecho para tu rutina", heading: "Una decisión clara", body: "Conocé el producto antes de elegirlo.", points: ["Detalles fáciles de consultar", "Una experiencia directa"] },
      stories: { heading: "Conocé el producto", intro: "Detalles visuales para recorrer a tu ritmo.", cards: [
        { title: "Presentación", body: "Mirá el producto desde distintos ángulos disponibles.", product_note: "Detalle del catálogo" },
        { title: "Información", body: "Consultá los datos que acompañan a esta publicación.", product_note: "Información del producto" },
        { title: "Elección", body: "Revisá las opciones antes de añadirlo al carrito.", product_note: "Opciones disponibles" }
      ] },
      timeline: { heading: "Tu recorrido", intro: "Una guía clara para empezar.", steps: [{ label: "Paso uno", heading: "Conocé el producto", body: "Revisá la información disponible." }, { label: "Paso dos", heading: "Elegí tu opción", body: "Seleccioná la presentación adecuada." }] },
      faq: { heading: "Preguntas frecuentes", intro: "Respuestas claras para elegir con información disponible.", items: [{ question: "¿Cómo elijo?", answer: "Revisá la información del producto." }, { question: "¿Qué incluye?", answer: "La presentación seleccionada." }, { question: "¿Dónde veo variantes?", answer: "En las opciones de compra." }] },
      closing: { eyebrow: "Información disponible", heading: "Elegí con calma", body: "Conocé los detalles del producto antes de comprar.", secondary_body: "Las opciones se actualizan desde Shopify." },
      newsletter: { heading: "Recibí novedades por email", body: "Novedades y recursos de la tienda." },
      media: { hero_media_id: "gid://shopify/MediaImage/10", gallery_media_ids: ["gid://shopify/MediaImage/10"], story_media_ids: ["gid://shopify/MediaImage/10"] }
    }
  };
}

function modelCopy() {
  const content = page().content;
  return {
    hero: content.hero,
    offer: { heading: content.offer.heading },
    quick: content.quick,
    why: content.why,
    stories: content.stories,
    timeline: content.timeline,
    faq: content.faq,
    closing: content.closing,
    newsletter: content.newsletter
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
  const source = {
    ...page().source_fields,
    media_ids: [
      "gid://shopify/MediaImage/10",
      "gid://shopify/MediaImage/20",
      "gid://shopify/MediaImage/30"
    ]
  };
  const copy = modelCopy();
  const content = composePdp01Content(copy, source);
  assert.deepEqual(content.offer.packs.map((pack) => pack.quantity), [1, 3, 5]);
  assert.deepEqual(content.offer.packs.map((pack) => pack.variant_id), [source.variants[0].id, source.variants[0].id, source.variants[0].id]);
  assert.equal(content.media.hero_media_id, source.media_ids[0]);
  assert.equal(content.media.comparison_media_id, source.media_ids[1]);
  assert.equal(content.media.community_media_id, source.media_ids[2]);
  assert.deepEqual(content.media.gallery_media_ids, source.media_ids);
  assert.deepEqual(content.media.story_media_ids, source.media_ids);
  assert.doesNotThrow(() => validatePdp01({ ...page(), source_fields: source, source_hash: hashSource(source), content }));
});
test("Piloto 01 rechaza un sobre, campos extra y medios generados por la IA", () => {
  const copy = modelCopy();
  assert.deepEqual(copyFromModelJson(JSON.stringify(copy)), copy);
  assert.throws(() => copyFromModelJson(JSON.stringify({ content: copy })), /copy\.content no pertenece al contrato/);
  assert.throws(() => copyFromModelJson(JSON.stringify({ ...copy, media: {} })), /copy\.media no pertenece al contrato/);
});
test("el esquema estructurado deja sólo copy abierto a la IA", () => {
  assert.deepEqual(Object.keys(PDP01_COPY_OUTPUT_SCHEMA.properties).sort(), ["closing", "faq", "hero", "newsletter", "offer", "quick", "stories", "timeline", "why"]);
  assert.equal(PDP01_COPY_OUTPUT_SCHEMA.additionalProperties, false);
  assert.equal(PDP01_COPY_OUTPUT_SCHEMA.properties.offer.properties.packs, undefined);
  assert.deepEqual(commerceFromSource(page().source_fields).packs.map((pack) => pack.label), ["1 unidad", "3 unidades", "5 unidades"]);
});
test("el esquema enviado a Anthropic no usa cardinalidad de listas no soportada", () => {
  const forbiddenArrayKeywords = [];
  function inspect(value, path = "schema") {
    if (!value || typeof value !== "object") return;
    if (value.type === "array") {
      for (const key of ["minItems", "maxItems"]) if (Object.hasOwn(value, key)) forbiddenArrayKeywords.push(`${path}.${key}`);
    }
    for (const [key, child] of Object.entries(value)) inspect(child, `${path}.${key}`);
  }
  inspect(PDP01_COPY_OUTPUT_SCHEMA);
  assert.deepEqual(forbiddenArrayKeywords, []);

  // The stricter product requirement remains enforced after generation.
  const copy = { ...modelCopy(), hero: { ...page().content.hero, bullets: ["Un único punto"] } };
  assert.throws(() => copyFromModelJson(JSON.stringify(copy)), /copy\.hero\.bullets debe tener entre 2 y 4 elementos/);
});

test("Piloto 01 mantiene renderizables los documentos ya guardados", () => {
  const legacy = page();
  delete legacy.content.quick;
  delete legacy.content.stories;
  delete legacy.content.closing;
  delete legacy.content.newsletter;
  delete legacy.content.faq.intro;
  delete legacy.content.media.story_media_ids;
  assert.doesNotThrow(() => validatePdp01(legacy));
});
