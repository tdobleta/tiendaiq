"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { hashSource, validatePdp01, storefrontProjection } = require("../src/piloto/pdp01-contract");
const { contentFromModelJson } = require("../src/piloto/generate-pdp01");

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
test("Piloto 01 normaliza únicamente el sobre content de una respuesta de IA", () => {
  const expected = page().content;
  assert.deepEqual(contentFromModelJson(JSON.stringify({ content: expected })), expected);
  assert.throws(() => validatePdp01({ ...page(), content: contentFromModelJson(JSON.stringify({ content: expected, extra: true })) }), /content\.content no pertenece al contrato/);
});
