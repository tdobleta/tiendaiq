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
  assert.equal(productInformation.sourceSha256, "3c27a767d7334ab06fd0b2c6291e773cd388b14515fd7656728f69e94e6e08e8");
  assert.equal(sha256(productInformation.source), productInformation.sourceSha256);
  assert.equal(productInformation.schema.settings.length, 38);
  assert.equal(productInformation.schema.settings.filter((setting) => setting.id).length, 37);
  assert.equal(productInformation.schema.blocks.length, 6);
  assert.equal(productInformation.seed.blocks.length, 19);
  assert.equal(productInformation.editor.groups.length, 1);
  assert.equal(productInformation.editor.blocks.length, 6);
  assert.doesNotMatch(productInformation.source, /if hero_(?:max_width|column_gap|desktop_top|thumbnail_size)/);
  assert.doesNotMatch(productInformation.source, /\| replace:/);
});

test("crear una página conserva exactamente cada valor del preset Shopify", () => {
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
  assert.deepEqual(page.sections[0].instance, productInformation.seed);
  assert.equal(page.sections[0].instance.settings.heading, "NAD PRO COMPLEX");
  assert.equal(page.sections[0].instance.settings.max_width, 940);
  assert.equal(page.sections[0].instance.settings.card_gap, 5);
  assert.equal(page.sections[0].instance.settings.thumbnail_size, 60);
  assert.equal(page.sections[0].instance.settings.background_color, "#11151c");
  assert.equal(page.sections[0].instance.settings.bundle_heading, "BUNDLE & SAVE");
  assert.equal(page.sections[0].instance.settings.rating_stars, "★★★★★");
  assert.equal(page.productSnapshot.media.length, 1);
  assert.equal(page.sections[0].instance.blocks.some((block) => block.type === "media_thumb"), false);
  assert.equal(page.sections[0].instance.blocks.length, 19);
  assert.equal(page.sections[0].instance.blocks.filter((block) => block.type === "bundle").length, 3);
  assert.equal(page.sections[0].instance.blocks.some((block) => block.binding), false);
});

test("producto e investigación no pueden alterar el preset inicial", () => {
  const page = createProductPage({
    product: { id: "gid://shopify/Product/1", title: "Producto", variants: [] },
    research: {
      rating: { verified: false, label: "4.9 basado en 900 reseñas" },
      claims: [{ text: "Resultado garantizado", verified: false, source: "modelo" }]
    }
  });
  const instance = page.sections[0].instance;
  assert.deepEqual(instance, productInformation.seed);
  assert.equal(instance.blocks.filter((block) => block.type === "benefit").length, 4);
  assert.equal(instance.blocks.length, 19);
  assert.equal(instance.blocks.some((block) => block.settings?.text === "Resultado garantizado"), false);
  assert.equal(instance.blocks.some((block) => block.settings?.text === "Resultado garantizado"), false);
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
  assert.match(html, /NAD PRO COMPLEX/);
  assert.match(html, /https:\/\/cdn\.shopify\.com\/bolso\.jpg/);
  assert.match(html, /data-tiq-section-id="section-product-information"/);
  assert.match(html, /data-tiq-block-id=/);
  assert.match(html, /class="product-hero-section-product-information__bundle-image"/);
  assert.match(html, /class="product-hero-section-product-information__thumbnail-image"/);
  assert.match(html, /data-variant-id="gid:\/\/shopify\/ProductVariant\/1"/);
  assert.match(html, /class="product-hero-section-product-information__cta"[\s\S]*href="#"/);
  assert.match(html, /Fast Shipping/);
  assert.match(html, /60-Day Guarantee/);
});

test("la vista aislada reproduce la herencia tipográfica de Horizon", async () => {
  const html = await renderSectionPage(createProductPage({
    product: { id: "gid://shopify/Product/1", title: "Producto", variants: [] }
  }));
  assert.match(html, /family=Inter:wght@400;500;600;700;800;900/);
  assert.match(html, /font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;font-weight:400/);
  assert.match(html, /button,input,select,textarea\{font:inherit\}/);
  assert.match(html, /button,a\{color:inherit\}/);
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
