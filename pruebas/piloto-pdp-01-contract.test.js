"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { hashSource, validatePdp01, storefrontProjection } = require("../src/piloto/pdp01-contract");

function document() {
  const source_fields = {
    product_gid: "gid://shopify/Product/1", title: "Producto real", description: "Descripción real", vendor: "Marca", product_type: "Bienestar",
    options: [{ name: "Título", values: ["Default Title"] }],
    media_ids: ["gid://shopify/MediaImage/10"],
    variants: [{ id: "gid://shopify/ProductVariant/11", title: "Default Title" }]
  };
  return {
    contract_version: 1, template: "piloto-pdp-01", source_fields, source_hash: hashSource(source_fields), evidence: {},
    content: {
      hero: { claim: "Una forma simple de sumarlo a tu rutina", bullets: ["Información clara", "Elegí según tu necesidad"] },
      offer: { heading: "Opciones de compra", packs: [{ id: "unidad", label: "Una unidad", subtitle: "Para empezar", quantity: 1, mechanism: "multi_quantity", variant_id: "gid://shopify/ProductVariant/11" }], accordions: [] },
      why: { eyebrow: "Hecho para tu rutina", heading: "Una decisión clara", body: "Conocé el producto antes de elegirlo.", points: ["Detalles fáciles de consultar", "Una experiencia directa"] },
      timeline: { heading: "Tu recorrido", intro: "Una guía clara para empezar.", steps: [{ label: "Primer paso", heading: "Conocé el producto", body: "Revisá la información disponible." }, { label: "Siguiente paso", heading: "Elegí tu opción", body: "Seleccioná la presentación adecuada." }] },
      faq: { heading: "Preguntas frecuentes", items: [{ question: "¿Cómo elijo?", answer: "Revisá la información del producto." }, { question: "¿Qué incluye?", answer: "La presentación seleccionada." }, { question: "¿Dónde veo variantes?", answer: "En las opciones de compra." }] },
      media: { hero_media_id: "gid://shopify/MediaImage/10", gallery_media_ids: ["gid://shopify/MediaImage/10"] }
    }
  };
}

test("Piloto 01 elimina evidencia sin fuente antes de guardar", () => {
  const page = document();
  page.evidence.testimonial = { text: "Excelente", author: "Alguien" };
  const valid = validatePdp01(page, { origin: "ai" });
  assert.equal(valid.evidence.testimonial, undefined);
});

test("Piloto 01 rechaza campos que el contrato no declara", () => {
  const page = document();
  page.content.hero.html = "<script>alert(1)</script>";
  assert.throws(() => validatePdp01(page), /no es válido/);
});

test("Piloto 01 no admite porcentajes ni importes congelados en el copy", () => {
  const page = document();
  page.content.hero.claim = "Ahorrás 20% hoy";
  assert.throws(() => validatePdp01(page), /importe o porcentaje/);
});

test("Piloto 01 verifica que imágenes y variantes pertenezcan al producto", () => {
  const page = document();
  page.content.offer.packs[0].variant_id = "gid://shopify/ProductVariant/999";
  assert.throws(() => validatePdp01(page), /variante inexistente/);
});

test("Piloto 01 rechaza descuentos que todavía no están respaldados por Shopify", () => {
  const page = document();
  page.content.offer.packs[0].claimed_discount_pct = 15;
  page.content.offer.packs[0].discount_source = { kind: "merchant_document", reference: "promoción" };
  assert.throws(() => validatePdp01(page), /regla de Shopify verificada/);
});

test("la proyección para Shopify nunca expone la fuente de verdad", () => {
  const projection = storefrontProjection(document());
  assert.equal(projection.source_fields, undefined);
  assert.equal(projection.source_hash, undefined);
  assert.equal(projection.content.offer.packs[0].quantity, 1);
});

test("Piloto 01 valida por GID, pero agrega al carrito con el id vivo de Liquid", () => {
  const liquid = fs.readFileSync(path.join(__dirname, "../extensions/tiendaiq-widgets/blocks/pagina.liquid"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "../extensions/tiendaiq-widgets/assets/piloto-pdp-01.js"), "utf8");
  assert.match(liquid, /adminId: "gid:\/\/shopify\/ProductVariant\/\{\{ variant\.id \}\}"/);
  assert.match(liquid, /id: \{\{ variant\.id \| json \}\}/);
  assert.match(renderer, /candidate\.adminId === pack\.variant_id/);
  assert.match(renderer, /root\.querySelector\('\[name="id"\]'\)\.value = variant\.id/);
});
