"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const productInformation = require("../src/section-pipeline/product-information-v1");
const { createProductPage } = require("../src/section-pipeline/page-pipeline");
const { renderSectionPage } = require("../src/section-pipeline/preview-renderer");
const { validateResearch } = require("../src/section-pipeline/research-product");
const { SectionContractError, sha256, validateInstance } = require("../src/section-pipeline/section-contract");
const { build: buildStorefront } = require("../src/section-pipeline/compile-storefront");

test("el código Shopify es la fuente inmutable del diseño y del editor", () => {
  assert.equal(productInformation.sourceSha256, "fd35e67c5292e68d95ee30d9fcfe68d6f22f4cbad8a1b067b12921bacb0a0d36");
  assert.equal(sha256(productInformation.source), productInformation.sourceSha256);
  assert.equal(productInformation.schema.settings.length, 38);
  assert.equal(productInformation.schema.settings.filter((setting) => setting.id).length, 37);
  assert.equal(productInformation.schema.blocks.length, 6);
  assert.equal(productInformation.seed.blocks.length, 19);
  assert.equal(productInformation.editor.groups.length, 1);
  assert.equal(productInformation.editor.blocks.length, 6);
});

test("crear una página adapta datos pero conserva exactamente el diseño", () => {
  const before = productInformation.source;
  const page = createProductPage({
    product: {
      id: "gid://shopify/Product/123",
      title: "Bolso Atelier",
      description: "Cuero flexible con cierre metálico.",
      media: [{ id: "gid://shopify/MediaImage/1", url: "https://cdn.shopify.com/bolso.jpg", altText: "Bolso marrón" }],
      variants: [{ id: "gid://shopify/ProductVariant/2", title: "Marrón", price: "$122.00" }]
    },
    research: { summary: "Un bolso versátil para el uso diario.", claims: [] }
  });
  assert.equal(productInformation.source, before);
  assert.equal(page.sections.length, 1);
  assert.equal(page.tree[0].label, "Info principal producto");
  assert.equal(page.sections[0].instance.settings.heading, "Bolso Atelier");
  assert.equal(page.sections[0].instance.settings.rating_stars, "");
  assert.equal(page.productSnapshot.media.length, 1);
  assert.equal(page.sections[0].instance.blocks.some((block) => block.type === "media_thumb"), false);
  const bundle = page.sections[0].instance.blocks.find((block) => block.type === "bundle");
  assert.ok(bundle);
  assert.deepEqual(bundle.binding, { variantId: "gid://shopify/ProductVariant/2", quantity: 1 });
});

test("la IA no puede inventar campos, reseñas ni claims sin evidencia", () => {
  const page = createProductPage({
    product: { id: "gid://shopify/Product/1", title: "Producto", variants: [] },
    research: {
      rating: { verified: false, label: "4.9 basado en 900 reseñas" },
      claims: [{ text: "Resultado garantizado", verified: false, source: "modelo" }]
    }
  });
  const instance = page.sections[0].instance;
  assert.equal(instance.settings.rating_text, "");
  assert.equal(instance.blocks.filter((block) => block.type === "benefit").length, 0);
  assert.equal(instance.blocks.filter((block) => ["trust_item", "payment", "tab"].includes(block.type)).length, 0);
  assert.throws(() => validateInstance({
    definition: productInformation,
    instance: { settings: { css_inventado: "display:none" }, blocks: [] }
  }), SectionContractError);
});

test("la vista del editor ejecuta la misma fuente Liquid con datos Shopify", async () => {
  const page = createProductPage({
    product: {
      id: "gid://shopify/Product/1",
      title: "Bolso Atelier",
      description: "Bolso urbano",
      media: { edges: [{ node: { id: "media-1", image: { url: "https://cdn.shopify.com/bolso.jpg" } } }] },
      variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/1", title: "Marrón", price: "122.00" } }] }
    }
  });
  const html = await renderSectionPage(page);
  assert.match(html, /Bolso Atelier/);
  assert.match(html, /https:\/\/cdn\.shopify\.com\/bolso\.jpg/);
  assert.match(html, /data-tiq-section-id="section-product-information"/);
  assert.match(html, /data-tiq-block-id=/);
  assert.match(html, /data-variant-id="gid:\/\/shopify\/ProductVariant\/1"/);
  assert.match(html, /data-cart-url="\/cart\/add\.js"/);
  assert.doesNotMatch(html, /693\+ Reseñas/);
  assert.doesNotMatch(html, /Garantía de 60 días/);
});

test("la investigación visual conserva evidencia y descarta referencias inventadas", () => {
  const research = validateResearch({
    summary: "Bolso de líneas sobrias.",
    claims: [{ text: "Cierre metálico", source: "shopify_description", verified: true }],
    visualObservations: [
      { text: "Color marrón", mediaId: "media-1" },
      { text: "Dato sin imagen", mediaId: "inventada" }
    ]
  }, ["media-1"]);
  assert.equal(research.claims.length, 1);
  assert.deepEqual(research.visualObservations, [{ text: "Color marrón", mediaId: "media-1" }]);
});

test("el snippet de Shopify se compila desde la misma fuente visual", () => {
  const { output } = buildStorefront({ write: false });
  assert.match(output, new RegExp(productInformation.sourceSha256));
  assert.match(output, /tiq_section\.instance\.settings/);
  assert.match(output, /tiq_section\.instance\.blocks/);
  assert.doesNotMatch(output, /{%\s*schema\s*%}/);
  assert.doesNotMatch(output, /section\.settings|section\.blocks|block\.shopify_attributes/);
});

test("el contrato sanea richtext y rechaza enlaces o rangos peligrosos", () => {
  const instance = JSON.parse(JSON.stringify(productInformation.seed));
  instance.settings.description = '<p onclick="alert(1)">Seguro<script>alert(1)</script></p>';
  instance.settings.max_width = 99999;
  assert.throws(() => validateInstance({ definition: productInformation, instance }), SectionContractError);
  instance.settings.max_width = 1200;
  const valid = validateInstance({ definition: productInformation, instance });
  assert.doesNotMatch(valid.settings.description, /onclick|<script>/);
});
