"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { hashSource } = require("../src/piloto/pdp01-contract");
const { applyTemplateBoundEdit, FixedTemplateEditError } = require("../src/domain/fixed-template-edit-policy");

function document() {
  const source_fields = { product_gid: "gid://shopify/Product/1", title: "Producto", description: "", vendor: "", product_type: "", options: [], media_ids: ["gid://shopify/MediaImage/1"], variants: [{ id: "gid://shopify/ProductVariant/1", title: "Única" }] };
  return { global: { template: { id: "piloto/pdp-01", version: 1 }, estilo: "piloto-pdp-01" }, fuente: { shopify_product_id: source_fields.product_gid }, piloto_pdp_01: { contract_version: 1, template: "piloto-pdp-01", source_fields, source_hash: hashSource(source_fields), evidence: {}, content: {
    hero: { claim: "Una idea simple", bullets: ["Beneficio uno", "Beneficio dos"] },
    offer: { heading: "Opciones", packs: [{ id: "unidad", label: "Una unidad", subtitle: "Para empezar", quantity: 1, mechanism: "multi_quantity", variant_id: "gid://shopify/ProductVariant/1" }] },
    quick: { items: [{ question: "¿Cómo?", answer: "Revisá." }, { question: "¿Qué?", answer: "La ficha." }] },
    why: { eyebrow: "Rutina", heading: "Elegí con claridad", body: "Información del producto", points: ["Punto uno", "Punto dos"] },
    stories: { heading: "Detalles", intro: "Conocé el producto.", cards: [{ title: "Presentación", body: "Un detalle.", product_note: "Producto" }, { title: "Información", body: "Otro detalle.", product_note: "Catálogo" }, { title: "Elección", body: "Una guía.", product_note: "Opciones" }] },
    timeline: { heading: "Recorrido", intro: "Guía", steps: [{ label: "Paso uno", heading: "Conocé", body: "Revisá" }, { label: "Paso dos", heading: "Elegí", body: "Seleccioná" }] },
    faq: { heading: "Preguntas", intro: "Respuestas claras.", items: [{ question: "¿Cómo?", answer: "Revisá." }, { question: "¿Qué?", answer: "La ficha." }, { question: "¿Dónde?", answer: "En Shopify." }] },
    closing: { eyebrow: "Detalle", heading: "Elegí con calma", body: "Conocé el producto.", secondary_body: "Revisá las opciones." },
    newsletter: { heading: "Novedades", body: "Recibí novedades de la tienda." },
    media: { hero_media_id: "gid://shopify/MediaImage/1", gallery_media_ids: ["gid://shopify/MediaImage/1"], story_media_ids: ["gid://shopify/MediaImage/1"] }
  } } };
}

test("Piloto 01 permite copy y bloquea packs, medios y fuente en la edición", () => {
  const persisted = document();
  const allowed = structuredClone(persisted);
  allowed.piloto_pdp_01.content.faq.items[0].answer = "Consultá la ficha del producto.";
  assert.equal(applyTemplateBoundEdit({ persistedData: persisted, submittedData: allowed }).piloto_pdp_01.content.faq.items[0].answer, "Consultá la ficha del producto.");
  const blocked = structuredClone(persisted);
  blocked.piloto_pdp_01.content.offer.packs[0].quantity = 5;
  assert.throws(() => applyTemplateBoundEdit({ persistedData: persisted, submittedData: blocked }), FixedTemplateEditError);

  const extended = structuredClone(persisted);
  extended.piloto_pdp_01.content.stories.cards[0].body = "Detalle actualizado del producto.";
  assert.equal(applyTemplateBoundEdit({ persistedData: persisted, submittedData: extended }).piloto_pdp_01.content.stories.cards[0].body, "Detalle actualizado del producto.");
});
